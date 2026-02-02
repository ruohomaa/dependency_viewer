import { useEffect, useState, useMemo } from 'react';
import ReactFlow, { Background, Controls, Panel, type Node, type Edge, Position, useNodesState, useEdgesState, MarkerType } from 'reactflow';
import dagre from 'dagre';
import 'reactflow/dist/style.css';
import './App.css';

const dagreGraph = new dagre.graphlib.Graph();
dagreGraph.setDefaultEdgeLabel(() => ({}));

const nodeWidth = 350;
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
  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);
  const [rawData, setRawData] = useState<any[]>([]);
  const [visibleTypes, setVisibleTypes] = useState<Set<string>>(new Set());
  
  // Search State
  const [searchTerm, setSearchTerm] = useState('');
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [selectedItems, setSelectedItems] = useState<Map<string, any>>(new Map()); // Map<id, Item>

  // Derive all unique types from raw data
  const allTypes = useMemo(() => {
    const types = new Set<string>();
    rawData.forEach((d) => {
      if (d.metadataComponentType) types.add(d.metadataComponentType);
      if (d.refMetadataComponentType) types.add(d.refMetadataComponentType);
    });
    return Array.from(types).sort();
  }, [rawData]);

  // Handle Search
  useEffect(() => {
    if (searchTerm.length < 2) {
      setSearchResults([]);
      return;
    }
    const timer = setTimeout(() => {
        const apiUrl = import.meta.env.DEV ? `http://localhost:3000/api/components?q=${searchTerm}` : `/api/components?q=${searchTerm}`;
        fetch(apiUrl)
            .then(res => res.json())
            .then(data => {
                setSearchResults(data);
            })
            .catch(err => console.error("Search failed", err));
    }, 300);
    return () => clearTimeout(timer);
  }, [searchTerm]);

  const toggleSearchSelection = (item: any) => {
    setSelectedItems(prev => {
        const next = new Map(prev);
        if (next.has(item.id)) next.delete(item.id);
        else next.set(item.id, item);
        return next;
    });
  };

  const clearSelection = () => {
    setSelectedItems(new Map());
  };

  const handleFetchSelected = () => {
    if (selectedItems.size === 0) return;

    const promises = Array.from(selectedItems.keys()).map(id => {
      const apiUrl = import.meta.env.DEV ? `http://localhost:3000/api/dependencies/${id}` : `/api/dependencies/${id}`;
      return fetch(apiUrl).then(res => res.json());
    });
    
    Promise.all(promises)
      .then(results => {
         const newData = results.flat();
         // Merge new data
         setRawData(prev => {
             // Deduplicate by database ID (d.id)
             const existingIds = new Set(prev.map(p => p.id));
             const uniqueNewData = newData.filter((d: any) => !existingIds.has(d.id));
             
             // Update visible types
             const newTypes = new Set(visibleTypes);
             uniqueNewData.forEach((d: any) => {
                if (d.metadataComponentType) newTypes.add(d.metadataComponentType);
                if (d.refMetadataComponentType) newTypes.add(d.refMetadataComponentType);
             });
             setVisibleTypes(newTypes);

             return [...prev, ...uniqueNewData];
         });
         setSearchTerm(''); // Clear search
         setSearchResults([]);
         setSelectedItems(new Map());
      })
      .catch(err => console.error("Fetch failed", err));
  };


  useEffect(() => {
    if (rawData.length === 0) {
        setNodes([]);
        setEdges([]);
        return;
    }

    const newNodes = new Map<string, Node>();
    const newEdges: Edge[] = [];
    
    rawData.forEach((d: any, index: number) => {
      const sourceType = d.metadataComponentType;
      const targetType = d.refMetadataComponentType;
      
      const isSourceVisible = visibleTypes.has(sourceType);
      const isTargetVisible = targetType ? visibleTypes.has(targetType) : false;

      // Create Source Node
      if (isSourceVisible && d.metadataComponentId && !newNodes.has(d.metadataComponentId)) {
        newNodes.set(d.metadataComponentId, {
          id: d.metadataComponentId,
          position: { x: 0, y: 0 },
          data: { label: `${sourceType}: ${d.metadataComponentName}`, type: sourceType },
          style: { width: nodeWidth },
        });
      }
      
      // Create Target Node
      if (isTargetVisible && d.refMetadataComponentId && !newNodes.has(d.refMetadataComponentId)) {
        newNodes.set(d.refMetadataComponentId, {
          id: d.refMetadataComponentId,
          position: { x: 0, y: 0 },
          data: { label: `${targetType}: ${d.refMetadataComponentComponentName || d.refMetadataComponentName}`, type: targetType },
          style: { width: nodeWidth },
        });
      }

      // Create Edge only if both nodes are visible
      if (isSourceVisible && isTargetVisible && d.metadataComponentId && d.refMetadataComponentId) {
        newEdges.push({
          id: `e${d.metadataComponentId}-${d.refMetadataComponentId}-${index}`,
          source: d.metadataComponentId,
          target: d.refMetadataComponentId,
          markerEnd: {
             type: MarkerType.ArrowClosed,
          },
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
      <ReactFlow 
        nodes={nodes} 
        edges={edges} 
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        fitView
      >
        <Background />
        <Controls />
        
        <Panel position="top-left" style={{ background: 'white', color: 'black', padding: '10px', borderRadius: '5px', boxShadow: '0 0 10px rgba(0,0,0,0.1)', display: 'flex', flexDirection: 'column' }}>
            <div style={{ fontWeight: 'bold', marginBottom: '5px' }}>Search Metadata</div>
            <div style={{ display: 'flex', gap: '5px', marginBottom: '5px' }}>
                <input 
                    type="text" 
                    placeholder="Type to search..." 
                    value={searchTerm} 
                    onChange={(e) => setSearchTerm(e.target.value)} 
                    style={{ padding: '8px', flex: 1, border: '1px solid #ccc', borderRadius: '4px', color: 'black', background: 'white' }}
                />
                 <button 
                    onClick={handleFetchSelected} 
                    disabled={selectedItems.size === 0}
                    style={{ 
                        padding: '8px 12px', 
                        cursor: selectedItems.size > 0 ? 'pointer' : 'not-allowed',
                        background: selectedItems.size > 0 ? '#007bff' : '#ccc',
                        color: 'white',
                        border: 'none',
                        borderRadius: '4px',
                        whiteSpace: 'nowrap'
                    }}
                >
                    Add ({selectedItems.size})
                </button>
            </div>

            {selectedItems.size > 0 && (
                <div style={{ marginBottom: '10px', padding: '5px', background: '#f0f0f0', borderRadius: '4px', maxHeight: '100px', overflowY: 'auto' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '5px', fontSize: '12px', fontWeight: 'bold' }}>
                        <span>Selected Items:</span>
                        <button onClick={clearSelection} style={{ background: 'none', border: 'none', color: '#d9534f', cursor: 'pointer', fontSize: '11px', textDecoration: 'underline' }}>Clear</button>
                    </div>
                    {Array.from(selectedItems.values()).map(item => (
                        <div key={item.id} style={{ fontSize: '12px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2px' }}>
                            <span style={{overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginRight: '5px' }}>{item.name}</span>
                            <span style={{color: '#666', fontSize: '10px'}}>{item.type}</span>
                             <button onClick={() => toggleSearchSelection(item)} style={{ marginLeft: '5px', background: 'none', border: 'none', cursor: 'pointer', color: '#999' }}>✕</button>
                        </div>
                    ))}
                </div>
            )}

            {searchTerm.length > 1 && searchResults.length > 0 && (
                <ul style={{ listStyle: 'none', padding: 0, margin: '5px 0 0 0', maxHeight: '300px', overflowY: 'auto', border: '1px solid #eee', background: 'white', color: 'black' }}>
                    {searchResults.map((res: any) => (
                        <li 
                            key={res.id} 
                            style={{ padding: '8px', cursor: 'pointer', borderBottom: '1px solid #f0f0f0', display: 'flex', alignItems: 'center', gap: '8px' }}
                            onMouseEnter={(e) => e.currentTarget.style.background = '#f9f9f9'}
                            onMouseLeave={(e) => e.currentTarget.style.background = 'white'}
                            onClick={() => toggleSearchSelection(res)}
                        >
                            <input 
                                type="checkbox" 
                                checked={selectedItems.has(res.id)} 
                                readOnly 
                                style={{ cursor: 'pointer' }}
                            />
                            <div>
                                <div style={{ fontWeight: 'bold', fontSize: '14px' }}>{res.name}</div>
                                <div style={{ fontSize: '11px', color: '#666' }}>{res.type}</div>
                            </div>
                        </li>
                    ))}
                </ul>
            )}
        </Panel>

        <Panel position="top-right" className="legend">
          <div className="legend-item" style={{ fontWeight: 'bold', borderBottom: '1px solid #ccc', paddingBottom: '5px', marginBottom: '5px' }}>
            <input 
              type="checkbox" 
              checked={allTypes.length > 0 && visibleTypes.size === allTypes.length}
              disabled={allTypes.length === 0}
              ref={input => {
                if (input) {
                  input.indeterminate = visibleTypes.size > 0 && visibleTypes.size < allTypes.length;
                }
              }}
              onChange={(e) => toggleAll(e.target.checked)}
            />
            <span>All Metadata Types</span>
          </div>
          {allTypes.length === 0 && <div style={{padding: '5px', color: '#666'}}>No data loaded</div>}
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
