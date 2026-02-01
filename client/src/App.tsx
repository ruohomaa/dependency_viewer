import { useEffect, useState, useMemo } from 'react';
import ReactFlow, { Background, Controls, Panel, type Node, type Edge, Position } from 'reactflow';
import dagre from 'dagre';
import 'reactflow/dist/style.css';
import './App.css';

const dagreGraph = new dagre.graphlib.Graph();
dagreGraph.setDefaultEdgeLabel(() => ({}));

const nodeWidth = 200;
// const nodeHeight = 50;

const getGroupedLayoutElements = (nodes: Node[]) => {
  if (nodes.length === 0) return { nodes: [] };

  const groups: Record<string, Node[]> = {};
  nodes.forEach((node) => {
    const type = node.data.type || 'Other';
    if (!groups[type]) groups[type] = [];
    groups[type].push(node);
  });

  const types = Object.keys(groups).sort();
  // Arrangement: Grid of Types
  // We'll try to keep it somewhat square or rectangular
  // const typesPerColumn = Math.ceil(Math.sqrt(types.length)); 
  
  // Spacing between groups
  // const groupGapX = 300; 
  // const groupGapY = 50;
  
  // Spacing between nodes within a group
  const nodeGapY = 60;

  // Track current positions
  // let currentGroupX = 0;
  // let currentGroupY = 0;
  
  // Max height of a row of groups to determine next Y start
  // Actually, let's just do columns of types for simplicity first, or wrapping rows.
  // "Type Columns" might be easier to read left-to-right.
  // Let's do a simple multi-column layout of TYPES.
  // Each "Column" on screen is one "Type".
  
  const TYPE_COLUMN_WIDTH = nodeWidth + 50;
  
  const layoutedNodes: Node[] = [];
  
  types.forEach((type, index) => {
    const groupNodes = groups[type];
    
    // Position for this Type Column
    const groupX = index * TYPE_COLUMN_WIDTH;
    const groupStartY = 0;
    
    groupNodes.forEach((node, nodeIdx) => {
      layoutedNodes.push({
        ...node,
        targetPosition: Position.Left,
        sourcePosition: Position.Right,
        position: {
          x: groupX,
          y: groupStartY + (nodeIdx * nodeGapY)
        }
      });
    });
  });

  return { nodes: layoutedNodes };
};


function App() {
  const [nodes, setNodes] = useState<Node[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);
  const [rawData, setRawData] = useState<any[]>([]);
  const [visibleTypes, setVisibleTypes] = useState<Set<string>>(new Set());

  // Derive all unique types from raw data
  const allTypes = useMemo(() => {
    const types = new Set<string>();
    rawData.forEach((d) => {
      if (d.metadataComponentType) types.add(d.metadataComponentType);
      if (d.refMetadataComponentType) types.add(d.refMetadataComponentType);
    });
    return Array.from(types).sort();
  }, [rawData]);

  useEffect(() => {
    // In dev: fetch from localhost:3000. In prod: relative path /api/dependencies
    const apiUrl = import.meta.env.DEV ? 'http://localhost:3000/api/dependencies' : '/api/dependencies';
    
    fetch(apiUrl)
      .then(res => res.json())
      .then(data => {
        // Limit to prevent crashing if too many
        const limit = 500; 
        const subset = data.slice(0, limit);
        
        // Initial setup of types
        const types = new Set<string>();
        subset.forEach((d: any) => {
          if (d.metadataComponentType) types.add(d.metadataComponentType);
          if (d.refMetadataComponentType) types.add(d.refMetadataComponentType);
        });
        
        setRawData(subset);
        setVisibleTypes(types);
      })
      .catch(err => console.error("Failed to fetch dependencies", err));
  }, []);

  useEffect(() => {
    if (rawData.length === 0) return;

    const newNodes = new Map<string, Node>();
    const newEdges: Edge[] = [];
    
    rawData.forEach((d: any, index: number) => {
      const sourceType = d.metadataComponentType;
      const targetType = d.refMetadataComponentType;
      
      const isSourceVisible = visibleTypes.has(sourceType);
      const isTargetVisible = targetType ? visibleTypes.has(targetType) : false;

      // Create Source Node
      if (isSourceVisible && !newNodes.has(d.metadataComponentId)) {
        newNodes.set(d.metadataComponentId, {
          id: d.metadataComponentId,
          position: { x: 0, y: 0 },
          data: { label: `${sourceType}: ${d.metadataComponentName}`, type: sourceType }
        });
      }
      
      // Create Target Node
      if (isTargetVisible && d.refMetadataComponentId && !newNodes.has(d.refMetadataComponentId)) {
        newNodes.set(d.refMetadataComponentId, {
          id: d.refMetadataComponentId,
          position: { x: 0, y: 0 },
          data: { label: `${targetType}: ${d.refMetadataComponentComponentName || d.refMetadataComponentName}`, type: targetType }
        });
      }

      // Create Edge only if both nodes are visible
      if (isSourceVisible && isTargetVisible && d.metadataComponentId && d.refMetadataComponentId) {
        newEdges.push({
          id: `e${d.metadataComponentId}-${d.refMetadataComponentId}-${index}`,
          source: d.metadataComponentId,
          target: d.refMetadataComponentId
        });
      }
    });

    const { nodes: layoutedNodes } = getGroupedLayoutElements(
      Array.from(newNodes.values())
    );

    setNodes(layoutedNodes);
    setEdges(newEdges);
  }, [rawData, visibleTypes]);

  const toggleType = (type: string) => {
    setVisibleTypes((prev) => {
      const next = new Set(prev);
      if (next.has(type)) {
        next.delete(type);
      } else {
        next.add(type);
      }
      return next;
    });
  };

  const toggleAll = (checked: boolean) => {
    if (checked) {
      setVisibleTypes(new Set(allTypes));
    } else {
      setVisibleTypes(new Set());
    }
  };

  return (
    <div style={{ width: '100vw', height: '100vh' }}>
      <ReactFlow nodes={nodes} edges={edges} fitView>
        <Background />
        <Controls />
        <Panel position="top-right" className="legend">
          <div className="legend-item" style={{ fontWeight: 'bold', borderBottom: '1px solid #ccc', paddingBottom: '5px', marginBottom: '5px' }}>
            <input 
              type="checkbox" 
              checked={allTypes.length > 0 && visibleTypes.size === allTypes.length}
              ref={input => {
                if (input) {
                  input.indeterminate = visibleTypes.size > 0 && visibleTypes.size < allTypes.length;
                }
              }}
              onChange={(e) => toggleAll(e.target.checked)}
            />
            <span>All Metadata Types</span>
          </div>
          {allTypes.map((type) => (
            <label key={type} className="legend-item">
              <input
                type="checkbox"
                checked={visibleTypes.has(type)}
                onChange={() => toggleType(type)}
              />
              {type}
            </label>
          ))}
        </Panel>
      </ReactFlow>
    </div>
  );
}

export default App;
