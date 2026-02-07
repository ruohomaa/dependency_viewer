import { useEffect, useState, useMemo, useRef, useCallback } from 'react';
import ReactFlow, { Background, Controls, Panel, type Node, type Edge, useNodesState, useEdgesState, MarkerType, Handle, Position, ReactFlowProvider, useReactFlow } from 'reactflow';
import dagre from 'dagre';
import * as d3 from 'd3-force';
import 'reactflow/dist/style.css';
import './App.css';

const dagreGraph = new dagre.graphlib.Graph();
dagreGraph.setDefaultEdgeLabel(() => ({}));

const DataNode = ({ data, selected }: any) => {
  return (
     <div style={{
         width: '100%', height: '100%', borderRadius: '50%',
         backgroundColor: `hsla(${data.hue}, 70%, 70%, 1)`,
         border: selected ? '3px solid #333' : `2px solid hsla(${data.hue}, 70%, 40%, 1)`,
         display: 'flex', alignItems: 'center', justifyContent: 'center',
         boxShadow: '0 2px 5px rgba(0,0,0,0.2)'
     }}>
         {data.showLabel && (
             <div style={{ 
                 position: 'absolute', 
                 left: '100%', 
                 marginLeft: '8px', 
                 whiteSpace: 'nowrap', 
                 fontSize: '12px',
                 fontWeight: 500,
                 textShadow: '0 0 2px white',
                 pointerEvents: 'none' 
             }}>
                 {data.label}
             </div>
         )}
         <Handle type="target" position={Position.Left} style={{ opacity: 0 }} />
         <Handle type="source" position={Position.Right} style={{ opacity: 0 }} />
     </div>
  );
};
const nodeTypes = { dataNode: DataNode };

const getColorForType = (type: string) => {
  let hash = 0;
  for (let i = 0; i < type.length; i++) {
    hash = type.charCodeAt(i) + ((hash << 5) - hash);
  }
  const hue = Math.abs(hash % 360);
  return hue;
};

const getGroupedLayoutElements = (nodes: Node[], edges: Edge[]) => {
  if (nodes.length === 0) return { nodes: [] };

  // 1. Group Nodes and Edges
  const typeGroups: Record<string, { nodes: Node[], internalEdges: Edge[] }> = {};
  const nodeTypeMap = new Map<string, string>();

  nodes.forEach(n => {
    const type = n.data.type || 'Other';
    nodeTypeMap.set(n.id, type);
    if (!typeGroups[type]) typeGroups[type] = { nodes: [], internalEdges: [] };
    typeGroups[type].nodes.push(n);
  });

  edges.forEach(e => {
    const sourceType = nodeTypeMap.get(e.source);
    const targetType = nodeTypeMap.get(e.target);
    if (sourceType && targetType && sourceType === targetType) {
      typeGroups[sourceType].internalEdges.push(e);
    }
  });

  const finalChildNodes: Node[] = [];
  const groupDimensions: Record<string, { width: number, height: number }> = {};
  const TITLE_HEIGHT = 40;

  // 2. Layout Internals and Measure Groups
  Object.keys(typeGroups).forEach(type => {
      const { nodes: gNodes } = typeGroups[type];
      
      // Sort nodes by label for consistent ordering
      gNodes.sort((a, b) => (a.data.label || '').localeCompare(b.data.label || ''));

      const count = gNodes.length;
      const NODE_SIZE = 50;
      const SPACING = 15;
      
      // Use Phyllotaxis arrangement (sunflower pattern) for compact circular packing
      // spacing constant c needs to factor in node size
      const c = (NODE_SIZE + SPACING) * 0.75; 
      
      // Calculate max extent to clear container size
      // Theoretically max radius is for the last item
      const maxRadius = count > 0 ? c * Math.sqrt(count) + (NODE_SIZE/2) : (NODE_SIZE + SPACING);

      const padding = 40;
      const groupWidth = (maxRadius * 2) + padding;
      const groupHeight = (maxRadius * 2) + padding;
      
      const centerX = groupWidth / 2;
      // Center Y accounts for title height offset
      const centerY = (groupHeight / 2) + TITLE_HEIGHT;

      gNodes.forEach((node, index) => {
          // Angle = index * 137.5 degrees (golden angle)
          const angle = index * 2.39996; 
          const r = c * Math.sqrt(index);

          // ReactFlow position is top-left
          const w = typeof node.style?.width === 'number' ? node.style.width : NODE_SIZE;
          const h = typeof node.style?.height === 'number' ? node.style.height : NODE_SIZE;
          
          const x = centerX + r * Math.cos(angle) - (w / 2);
          const y = centerY + r * Math.sin(angle) - (h / 2);

          node.position = { x, y };
      });

      groupDimensions[type] = {
          width: groupWidth,
          height: groupHeight + TITLE_HEIGHT
      };
  });

  // 3. Layout Groups (Inter-Type)
  const masterGraph = new dagre.graphlib.Graph();
  masterGraph.setGraph({ rankdir: 'LR', nodesep: 100, ranksep: 200 }); 
  masterGraph.setDefaultEdgeLabel(() => ({}));

  Object.keys(groupDimensions).forEach(type => {
      masterGraph.setNode(type, { 
          width: groupDimensions[type].width, 
          height: groupDimensions[type].height 
      });
  });

  const distinctEdges = new Set<string>();
  edges.forEach(e => {
      const sType = nodeTypeMap.get(e.source);
      const tType = nodeTypeMap.get(e.target);
      if (sType && tType && sType !== tType) {
          const key = `${sType}->${tType}`;
          if (!distinctEdges.has(key)) {
              masterGraph.setEdge(sType, tType);
              distinctEdges.add(key);
          }
      }
  });

  dagre.layout(masterGraph);

  // Apply master layout offsets to all children
  Object.keys(groupDimensions).forEach(type => {
      const g = masterGraph.node(type);
      const groupTopLeftX = g.x - (groupDimensions[type].width / 2);
      const groupTopLeftY = g.y - (groupDimensions[type].height / 2);

      const { nodes: gNodes } = typeGroups[type];
      gNodes.forEach(node => {
         node.position.x += groupTopLeftX;
         node.position.y += groupTopLeftY;
         finalChildNodes.push(node);
      });
  });

  return { nodes: finalChildNodes };
};


const getEffectiveType = (type: string, name: string) => {
  // If it has the word Test in it then it is a test class
  if (type === 'ApexClass' && name && name.toLowerCase().includes('test')) {
    return 'ApexTestClass';
  }
  return type;
};

// --- Cluster Analysis Logic ---
interface Cluster {
  id: number;
  nodeIds: Set<string>;
  nodes: any[];
  size: number;
}

const findClusters = (data: any[]): Cluster[] => {
  const adjList = new Map<string, Set<string>>();
  const nodeMap = new Map<string, any>();

  // Build Graph
  data.forEach((d) => {
    // Register Nodes
    if (d.metadataComponentId) {
      if (!adjList.has(d.metadataComponentId)) adjList.set(d.metadataComponentId, new Set());
      if (!nodeMap.has(d.metadataComponentId)) nodeMap.set(d.metadataComponentId, { id: d.metadataComponentId, name: d.metadataComponentName, type: d.metadataComponentType });
    }
    if (d.refMetadataComponentId) {
      if (!adjList.has(d.refMetadataComponentId)) adjList.set(d.refMetadataComponentId, new Set());
       // Note: d.refMetadataComponentName might be missing if it's just a ref, but usually we have it
       if (!nodeMap.has(d.refMetadataComponentId)) {
           nodeMap.set(d.refMetadataComponentId, { 
               id: d.refMetadataComponentId, 
               name: d.refMetadataComponentName || d.refMetadataComponentComponentName, 
               type: d.refMetadataComponentType 
            });
       }
    }

    // Register Edges (Undirected for cluster analysis)
    if (d.metadataComponentId && d.refMetadataComponentId && d.metadataComponentId !== d.refMetadataComponentId) {
      adjList.get(d.metadataComponentId)?.add(d.refMetadataComponentId);
      adjList.get(d.refMetadataComponentId)?.add(d.metadataComponentId);
    }
  });

  const visited = new Set<string>();
  const clusters: Cluster[] = [];
  let clusterId = 1;

  for (const nodeId of adjList.keys()) {
    if (!visited.has(nodeId)) {
      const clusterNodes = new Set<string>();
      const queue = [nodeId];
      visited.add(nodeId);
      clusterNodes.add(nodeId);

      while (queue.length > 0) {
        const curr = queue.shift()!;
        const neighbors = adjList.get(curr);
        if (neighbors) {
          for (const neighbor of neighbors) {
            if (!visited.has(neighbor)) {
              visited.add(neighbor);
              clusterNodes.add(neighbor);
              queue.push(neighbor);
            }
          }
        }
      }

      clusters.push({
        id: clusterId++,
        nodeIds: clusterNodes,
        nodes: Array.from(clusterNodes).map(id => nodeMap.get(id)).filter(n => n),
        size: clusterNodes.size
      });
    }
  }

  // Sort by size (descending)
  return clusters.sort((a, b) => b.size - a.size);
};

const matchFilter = (label: string, filter: string) => {
    if (!filter) return true;
    if (!label) return false;
    
    const l = label.toLowerCase();
    const f = filter.toLowerCase();
    
    if (f.includes('*')) {
        // Escape regex special characters except *
        const regexStr = '^' + f.split('*').map(s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*') + '$';
        return new RegExp(regexStr).test(l);
    }
    
    return l.includes(f);
};

function AppContent() {
  const { fitView } = useReactFlow();
  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);
  const [rawData, setRawData] = useState<any[]>([]);
  const [visibleTypes, setVisibleTypes] = useState<Set<string>>(new Set());
  const [typeFilters, setTypeFilters] = useState<Record<string, string>>({});
  const [globalFilter, setGlobalFilter] = useState('');
  
  // Cluster Analysis State
  const [clusters, setClusters] = useState<Cluster[]>([]);
  const [showAnalysisPanel, setShowAnalysisPanel] = useState(false);
  const [isAnalysisRunning, setIsAnalysisRunning] = useState(false);
  
  // Force Simulation
  const simulationRef = useRef<any>(null);
  
  // Search State
  const [searchTerm, setSearchTerm] = useState('');
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [selectedItems, setSelectedItems] = useState<Map<string, any>>(new Map()); // Map<id, Item>
  const [isLoading, setIsLoading] = useState(false);
  const [isSearchExpanded, setIsSearchExpanded] = useState(true);
  const [isLegendExpanded, setIsLegendExpanded] = useState(true);
  const [fetchedResults, setFetchedResults] = useState<Map<string, any[]>>(new Map());
  const [useLocalDb, setUseLocalDb] = useState(false);
  const [showLabels, setShowLabels] = useState(true);
  const [showOrphansOnly, setShowOrphansOnly] = useState(false);
  const [showHighlyConnected, setShowHighlyConnected] = useState(false);
  const [connectionThreshold, setConnectionThreshold] = useState(5);

  useEffect(() => {
     // Re-layout when effective nodes/edges change
     if (nodes.length > 0) {
        // Run static layout first
        const { nodes: layoutNodes } = getGroupedLayoutElements(nodes, edges);

        // Initialize Force Simulation
        if (simulationRef.current) {
            simulationRef.current.stop();
        }

        const simNodes = layoutNodes.map(n => ({ 
            ...n, 
            x: n.position.x, 
            y: n.position.y,
            // Store initial group position for clustering force
            initialX: n.position.x,
            initialY: n.position.y
        }));
        
        const simLinks = edges.map(e => ({ ...e, source: e.source, target: e.target }));

        const simulation = d3.forceSimulation(simNodes as any)
            .force("charge", d3.forceManyBody().strength(-300))
            .force("link", d3.forceLink(simLinks as any).id((d: any) => d.id).distance(100))
            .force("collide", d3.forceCollide().radius((d: any) => (d.style?.width || 50) / 2 + 10))
            // Add a force to pull nodes back to their group center/initial position to maintain clusters
            .force("x", d3.forceX((d: any) => d.initialX).strength(0.05))
            .force("y", d3.forceY((d: any) => d.initialY).strength(0.05))
            .alphaDecay(0.05);

        simulation.on("tick", () => {
             setNodes(prev => prev.map(n => {
                 const simNode = simNodes.find(sn => sn.id === n.id);
                 if (simNode) {
                     return { ...n, position: { x: simNode.x, y: simNode.y } };
                 }
                 return n;
             }));
        });

        simulationRef.current = simulation;

        return () => {
            if (simulationRef.current) simulationRef.current.stop();
        };
     }
  }, [nodes.length, edges.length]); // Only re-run if count changes, not on positions

  const onNodeDragStart = useCallback((_: any, node: Node) => {
      if (!simulationRef.current) return;
      simulationRef.current.alphaTarget(0.3).restart();
      const n = simulationRef.current.nodes().find((d: any) => d.id === node.id);
      if (n) {
          n.fx = node.position.x;
          n.fy = node.position.y;
      }
  }, []);

  const onNodeDrag = useCallback((_: any, node: Node) => {
      if (!simulationRef.current) return;
      const n = simulationRef.current.nodes().find((d: any) => d.id === node.id);
      if (n) {
          n.fx = node.position.x;
          n.fy = node.position.y;
      }
  }, []);

  const onNodeDragStop = useCallback((_: any, node: Node) => {
      if (!simulationRef.current) return;
      if (!(_ as any).active) simulationRef.current.alphaTarget(0);
      const n = simulationRef.current.nodes().find((d: any) => d.id === node.id);
      if (n) {
          n.fx = node.position.x;
          n.fy = node.position.y;
      }
  }, []);

  // Derive all unique types from raw data
  const allTypes = useMemo(() => {
    const types = new Set<string>();
    rawData.forEach((d) => {
      if (d.metadataComponentType) types.add(getEffectiveType(d.metadataComponentType, d.metadataComponentName));
      if (d.refMetadataComponentType) types.add(getEffectiveType(d.refMetadataComponentType, d.refMetadataComponentName || d.refMetadataComponentComponentName));
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

  const fetchDependencies = (item: any) => {
    let apiUrl = import.meta.env.DEV ? `http://localhost:3000/api/dependencies/${item.id}` : `/api/dependencies/${item.id}`;
    if (useLocalDb) apiUrl += '?source=local';
    // To support user request "view ... from local database", let's assume if we are in "Local View" mode
    
    fetch(apiUrl)
      .then(res => res.json())
      .then(fetchedData => {
         const stubData = {
             id: `stub-${item.id}`,
             metadataComponentId: item.id,
             metadataComponentName: item.name,
             metadataComponentType: item.type,
             refMetadataComponentId: null,
             refMetadataComponentName: null,
             refMetadataComponentType: null
         };
         const newData = [stubData, ...fetchedData];
         
         setFetchedResults(prev => {
             const next = new Map(prev);
             next.set(item.id, newData);
             return next;
         });
      })
      .catch(err => console.error("Fetch failed", err))
      .finally(() => setIsLoading(false));
  };

  const toggleSearchSelection = (item: any) => {
    const isSelected = selectedItems.has(item.id);

    if (isSelected) {
        setSelectedItems(prev => {
            const next = new Map(prev);
            if (next.has(item.id)) next.delete(item.id);
            return next;
        });
    } else {
        setSelectedItems(prev => {
            const next = new Map(prev);
            next.set(item.id, item);
            return next;
        });
        if (!fetchedResults.has(item.id)) {
            fetchDependencies(item);
        }
    }
  };

  const clearSelection = () => {
    setSelectedItems(new Map());
    setFetchedResults(new Map());
  };

  const loadAllDependencies = () => {
      setIsLoading(true);
      const apiUrl = import.meta.env.DEV ? `http://localhost:3000/api/dependencies` : `/api/dependencies`;
      
      fetch(apiUrl)
        .then(res => res.json())
        .then(data => {
            console.log(`Loaded ${data.length} dependencies`);
            setRawData(data);
            
             setVisibleTypes(prevTypes => {
                const nextTypes = new Set(prevTypes);
                data.forEach((d: any) => {
                    if (d.metadataComponentType) nextTypes.add(getEffectiveType(d.metadataComponentType, d.metadataComponentName));
                    if (d.refMetadataComponentType) nextTypes.add(getEffectiveType(d.refMetadataComponentType, d.refMetadataComponentName || d.refMetadataComponentComponentName));
                });
                return nextTypes;
            });
        })
        .catch(err => console.error("Failed to load all dependencies", err))
        .finally(() => setIsLoading(false));
  };

  const onNodeDoubleClick = (_: React.MouseEvent, node: Node) => {
      const apiUrl = import.meta.env.DEV ? `http://localhost:3000/api/open` : `/api/open`;
      fetch(apiUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: node.id })
      })
      .then(res => {
          if (!res.ok) return res.json().then(e => { throw new Error(e.error) });
      })
      .catch(err => {
          console.error("Failed to open in Salesforce:", err);
          alert(`Failed to open in Salesforce: ${err.message}`);
      });
  };

  useEffect(() => {
     if (selectedItems.size > 0) {
        const nextRawData: any[] = [];
        const seenIds = new Set<string>();
        
        selectedItems.forEach((_, id) => {
            const items = fetchedResults.get(id);
            if (items) {
                items.forEach((d: any) => {
                    if (!seenIds.has(d.id)) {
                        seenIds.add(d.id);
                        nextRawData.push(d);
                    }
                });
            }
        });
        setRawData(nextRawData);
     }
  }, [selectedItems, fetchedResults]);

  useEffect(() => {
    if (rawData.length === 0) {
        setNodes([]);
        setEdges([]);
        return;
    }

    const newNodes = new Map<string, Node>();
    const newEdges: Edge[] = [];
    
    // Calculate incoming edges to identify orphans and total connections
    const hasIncoming = new Set<string>();
    const connectionCounts = new Map<string, number>();

    rawData.forEach((d: any) => {
        if (d.metadataComponentId && d.refMetadataComponentId && d.metadataComponentId !== d.refMetadataComponentId) {
            hasIncoming.add(d.refMetadataComponentId);
            
            const src = d.metadataComponentId;
            const tgt = d.refMetadataComponentId;
            connectionCounts.set(src, (connectionCounts.get(src) || 0) + 1);
            connectionCounts.set(tgt, (connectionCounts.get(tgt) || 0) + 1);
        }
    });

    // NEW: Calculate Strict Filter (Matched + Dependencies)
    // If strict filtering is active (global or type-specific), we identify "Seed" nodes that match the filter.
    // Then we assume any connected node (neighbor) is also relevant for context and include it.
    // Unfiltered types will only self-display if connected to a match.
    
    const activeFilterTypes = new Set<string>();
    Object.entries(typeFilters).forEach(([t, f]) => {
        if (f && f.length > 0) activeFilterTypes.add(t);
    });
    const isGlobalFilterActive = globalFilter && globalFilter.length > 0;
    const isFilteringActive = activeFilterTypes.size > 0 || isGlobalFilterActive;
    
    let allowedIds: Set<string> | null = null;
    
    if (isFilteringActive) {
        allowedIds = new Set<string>();
        const matchedIds = new Set<string>();
        
        // Pass 1: Identify "Seed" nodes (Direct Matches)
        rawData.forEach((d: any) => {
            const checkSeed = (id: string, name: string, rawType: string) => {
                if (!id) return;
                const type = getEffectiveType(rawType, name);
                
                // Only consider checking if the type is visible
                if (!visibleTypes.has(type)) return;

                // Check if this type participates in the explicit filtering
                // Global filter affects all. Type filter affects specific.
                const hasSpecificFilter = activeFilterTypes.has(type);
                const hasExplicitFilter = hasSpecificFilter || isGlobalFilterActive;
                
                // If this type has NO explicit filter, it cannot be a seed 
                // (it can only be visible via dependency on a seed)
                if (!hasExplicitFilter) return;

                const filter = hasSpecificFilter ? typeFilters[type] : globalFilter;
                if (matchFilter(name, filter)) {
                    matchedIds.add(id);
                    allowedIds!.add(id);
                }
            };
            
            if (d.metadataComponentId) checkSeed(d.metadataComponentId, d.metadataComponentName, d.metadataComponentType);
            if (d.refMetadataComponentId) checkSeed(d.refMetadataComponentId, d.refMetadataComponentName || d.refMetadataComponentComponentName, d.refMetadataComponentType);
        });
        
        // Pass 2: Add Neighbors of Seeds
        rawData.forEach((d: any) => {
            const sId = d.metadataComponentId;
            const tId = d.refMetadataComponentId;
            if (sId && tId && sId !== tId) {
                if (matchedIds.has(sId)) allowedIds!.add(tId);
                if (matchedIds.has(tId)) allowedIds!.add(sId);
            }
        });
    }

    // Helper to calculate size based on lines of code
    const calcSize = (size?: number) => {
        if (!size) return 20; 
        const v = 15 + (Math.log(size || 10) * 5); // Adjusted log scale
        return Math.min(Math.max(v, 20), 80);
    };

    rawData.forEach((d: any, index: number) => {
      const sourceType = getEffectiveType(d.metadataComponentType, d.metadataComponentName);
      const targetType = d.refMetadataComponentType
        ? getEffectiveType(d.refMetadataComponentType, d.refMetadataComponentComponentName || d.refMetadataComponentName)
        : null;
      
      const isVisible = (type: string, name: string, id: string) => {
          if (showOrphansOnly && hasIncoming.has(id)) return false;
          if (showHighlyConnected) {
             const count = connectionCounts.get(id) || 0;
             if (count < connectionThreshold) return false;
          }
          if (!visibleTypes.has(type)) return false;
          
          if (allowedIds) {
              return allowedIds.has(id);
          }

          const filter = typeFilters[type] !== undefined ? typeFilters[type] : globalFilter;
          return matchFilter(name, filter);
      };

      const isSourceVisible = d.metadataComponentId ? isVisible(sourceType, d.metadataComponentName, d.metadataComponentId) : false;
      const isTargetVisible = targetType && d.refMetadataComponentId ? isVisible(targetType, d.refMetadataComponentComponentName || d.refMetadataComponentName, d.refMetadataComponentId) : false;

      // Create Source Node
      if (isSourceVisible && d.metadataComponentId && !newNodes.has(d.metadataComponentId)) {
        const size = calcSize(d.metadataComponentSize);
        newNodes.set(d.metadataComponentId, {
          id: d.metadataComponentId,
          position: { x: 0, y: 0 },
          type: 'dataNode',
          data: { 
              label: d.metadataComponentName, 
              type: sourceType, 
              hue: getColorForType(sourceType),
              showLabel: showLabels 
          },
          style: { width: size, height: size },
        });
      }
      
      // Create Target Node
      if (isTargetVisible && d.refMetadataComponentId && !newNodes.has(d.refMetadataComponentId)) {
        const size = calcSize(d.refMetadataComponentSize);
        newNodes.set(d.refMetadataComponentId, {
          id: d.refMetadataComponentId,
          position: { x: 0, y: 0 },
          type: 'dataNode',
          data: { 
              label: d.refMetadataComponentComponentName || d.refMetadataComponentName, 
              type: targetType!, 
              hue: getColorForType(targetType!),
              showLabel: showLabels 
          },
          style: { width: size, height: size },
        });
      }

      // Create Edge only if both nodes are visible
      if (isSourceVisible && isTargetVisible && d.metadataComponentId && d.refMetadataComponentId && d.metadataComponentId !== d.refMetadataComponentId) {
        newEdges.push({
          id: d.id || `e${d.metadataComponentId}-${d.refMetadataComponentId}-${index}`,
          source: d.metadataComponentId,
          target: d.refMetadataComponentId,
          type: 'straight',
          style: { stroke: '#ccc', strokeWidth: 1 },
          markerEnd: { type: MarkerType.ArrowClosed, color: '#ccc' },
        });
      }
    });

    const { nodes: layoutedNodes } = getGroupedLayoutElements(
      Array.from(newNodes.values()),
      newEdges
    );

    setNodes(layoutedNodes);
    setEdges(newEdges);
    
    if (layoutedNodes.length > 0) {
       setTimeout(() => fitView({ padding: 0.2, duration: 800 }), 100);
    }
  }, [rawData, visibleTypes, typeFilters, globalFilter, showOrphansOnly, showHighlyConnected, connectionThreshold]); // Removed showLabels, handled separately

  // Separate effect to update labels without re-layout
  useEffect(() => {
    setNodes((nds) =>
      nds.map((node) => {
        if (node.type === 'dataNode') {
          return { ...node, data: { ...node.data, showLabel: showLabels } };
        }
        return node;
      })
    );
  }, [showLabels]);

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

  const runAnalysis = () => {
    setIsAnalysisRunning(true);
    // Defer to next tick to allow UI to update
    setTimeout(() => {
        const results = findClusters(rawData);
        setClusters(results);
        setIsAnalysisRunning(false);
        setShowAnalysisPanel(true);
    }, 100);
  };
  
  const selectCluster = (cluster: Cluster) => {
      setSelectedItems(new Map()); // clear previous
      const nextSelected = new Map();
      cluster.nodes.forEach(n => {
         const item = { id: n.id, name: n.name, type: n.type };
         // Create a faux item to select
         nextSelected.set(n.id, item);

         // Ensure we have data for this item, otherwise the graph will be empty for it
         if (!fetchedResults.has(n.id)) {
             fetchDependencies(item);
         }
      });
      setSelectedItems(nextSelected);
  };

  return (
    <div style={{ width: '100vw', height: '100vh' }}>
      <ReactFlow 
        nodes={nodes} 
        edges={edges} 
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeDoubleClick={onNodeDoubleClick}
        onNodeDragStart={onNodeDragStart}
        onNodeDrag={onNodeDrag}
        onNodeDragStop={onNodeDragStop}
        fitView
        minZoom={0.01}
        maxZoom={4}
      >
        <Background />
        <Controls />
        
        <Panel position="top-left" style={{ background: 'white', color: 'black', padding: '10px', borderRadius: '5px', boxShadow: '0 0 10px rgba(0,0,0,0.1)', display: 'flex', flexDirection: 'column', maxHeight: '80vh', maxWidth: '350px' }}>
            <div style={{ display: 'flex', gap: '8px', marginBottom: '10px' }}>
                 <button onClick={() => setUseLocalDb(!useLocalDb)} style={{ 
                     background: useLocalDb ? '#0070d2' : '#f4f6f9',
                     color: useLocalDb ? 'white' : 'black',
                     border: '1px solid #ddd',
                     padding: '5px 10px',
                     borderRadius: '4px',
                     cursor: 'pointer',
                     flex: 1, fontSize: '12px'
                 }}>
                     {useLocalDb ? 'Source: Local DB' : 'Source: Salesforce'}
                 </button>
                 
                 <button 
                    onClick={loadAllDependencies} 
                    disabled={!useLocalDb}
                    style={{
                     background: !useLocalDb ? '#ccc' : '#4caf50',
                     color: 'white',
                     border: 'none',
                     padding: '5px 10px',
                     borderRadius: '4px',
                     cursor: !useLocalDb ? 'not-allowed' : 'pointer',
                     flex: 1, fontSize: '12px'
                 }}>
                     Load All (DB)
                 </button>
            </div>            
            <div style={{ marginBottom: '10px' }}>
                 <label style={{ display: 'flex', alignItems: 'center', cursor: 'pointer' }}>
                   <input 
                     type="checkbox" 
                     checked={showLabels} 
                     onChange={(e) => setShowLabels(e.target.checked)}
                     style={{ marginRight: '8px' }}
                   />
                   Show Labels
                 </label>
            </div>
            <div 
                style={{ fontWeight: 'bold', marginBottom: '5px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer' }}
                onClick={() => setIsSearchExpanded(!isSearchExpanded)}
            >
                <span>Search Metadata {isLoading && <span style={{fontSize: '0.8em', fontWeight: 'normal', color: '#666'}}>(Loading...)</span>}</span>
                <span style={{ marginLeft: '10px' }}>{isSearchExpanded ? '▼' : '▶'}</span>
            </div>
            {isSearchExpanded && (
                <>
                <div style={{ display: 'flex', gap: '5px', marginBottom: '5px' }}>
                <input 
                    type="text"  
                    placeholder="Type to search..." 
                    value={searchTerm} 
                    onChange={(e) => setSearchTerm(e.target.value)} 
                    style={{ padding: '8px', flex: 1, border: '1px solid #ccc', borderRadius: '4px', color: 'black', background: 'white' }}
                />

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
            </>
            )}
        </Panel>

        <Panel position="top-right" className="legend">
          <div 
             style={{ fontWeight: 'bold', marginBottom: '5px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer', borderBottom: isLegendExpanded ? '1px solid #ccc' : 'none', paddingBottom: isLegendExpanded ? '5px' : '0' }}
             onClick={() => setIsLegendExpanded(!isLegendExpanded)}
          >
            <span>Filter Types</span>
            <span style={{ marginLeft: '10px' }}>{isLegendExpanded ? '▼' : '▶'}</span>
          </div>
          {isLegendExpanded && (
          <>
          <div style={{ marginBottom: '5px' }}>
            <input 
                type="text"
                placeholder="Global Filter (* for wildcard)"
                value={globalFilter}
                onChange={(e) => setGlobalFilter(e.target.value)}
                onClick={(e) => e.stopPropagation()}
                style={{ width: '100%', padding: '4px', boxSizing: 'border-box', border: '1px solid #ccc', borderRadius: '3px' }}
            />
          </div>
          <div style={{ paddingBottom: '10px', marginBottom: '5px', borderBottom: '1px solid #eee' }}>
             <button 
                onClick={runAnalysis}
                disabled={isAnalysisRunning || rawData.length === 0}
                style={{
                  width: '100%',
                  padding: '6px',
                  background: '#0176d3',
                  color: 'white',
                  border: 'none',
                  borderRadius: '3px',
                  cursor: 'pointer',
                  fontWeight: 500
                }}
             >
                {isAnalysisRunning ? 'Running Analysis...' : 'Find Island Clusters'}
             </button>
             {clusters.length > 0 && (
                <div style={{ marginTop: '5px', fontSize: '12px', color: '#666', display: 'flex', justifyContent: 'space-between' }}>
                    <span>Found {clusters.filter(c => c.size > 1).length} groups</span>
                    <button onClick={() => setShowAnalysisPanel(true)} style={{ background:'none', border:'none', color:'#0176d3', cursor:'pointer', textDecoration:'underline', padding:0 }}>View Results</button>
                </div>
             )}
          </div>

          <div style={{ marginBottom: '5px', borderBottom: '1px solid #eee', paddingBottom: '5px' }}>
            <label style={{ display: 'flex', alignItems: 'center', cursor: 'pointer', flex: 1, fontWeight: '500' }}>
                <input 
                    type="checkbox" 
                    checked={showOrphansOnly} 
                    onChange={(e) => setShowOrphansOnly(e.target.checked)}
                    style={{ marginRight: '6px' }}
                />
                Show Orphans Only
            </label>
          </div>
          <div style={{ marginBottom: '5px', borderBottom: '1px solid #eee', paddingBottom: '5px' }}>
             <label style={{ display: 'flex', alignItems: 'center', cursor: 'pointer', flex: 1, fontWeight: '500', marginBottom: showHighlyConnected ? '4px' : '0' }}>
                <input 
                    type="checkbox" 
                    checked={showHighlyConnected} 
                    onChange={(e) => setShowHighlyConnected(e.target.checked)}
                    style={{ marginRight: '6px' }}
                />
                Show Highly Connected
            </label>
            {showHighlyConnected && (
                <div style={{ paddingLeft: '24px' }}>
                    <input 
                        type="number" 
                        min="1"
                        value={connectionThreshold} 
                        onChange={(e) => setConnectionThreshold(parseInt(e.target.value) || 1)}
                        onClick={(e) => e.stopPropagation()} 
                         style={{ width: '50px', padding: '2px', fontSize: '11px', border: '1px solid #ccc', borderRadius: '3px' }}
                    />
                    <span style={{ fontSize: '11px', marginLeft: '5px', color: '#666' }}>min connections</span>
                </div>
            )}
          </div>
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
            <div key={type} className="legend-item" style={{ justifyContent: 'space-between' }}>
                <label style={{ display: 'flex', alignItems: 'center', cursor: 'pointer', flex: 1 }}>
                  <input
                    type="checkbox"
                    checked={visibleTypes.has(type)}
                    onChange={() => toggleType(type)}
                  />
                   <span style={{ 
                      display: 'inline-block', 
                      width: '12px', 
                      height: '12px', 
                      backgroundColor: `hsl(${getColorForType(type)}, 60%, 60%)`,
                      borderRadius: '2px',
                      border: '1px solid rgba(0,0,0,0.1)',
                      marginLeft: '6px',
                      marginRight: '6px'
                  }}></span>
                  {type}
                </label>
                <input 
                   type="text"
                   placeholder="Filter"
                   value={typeFilters[type] || ''}
                   onChange={(e) => {
                       const val = e.target.value;
                       setTypeFilters(prev => {
                           const next = {...prev};
                           if (val) next[type] = val;
                           else delete next[type];
                           return next;
                       });
                   }}
                   onClick={(e) => e.stopPropagation()}
                   style={{ width: '60px', padding: '2px', fontSize: '11px', border: '1px solid #ccc', borderRadius: '3px' }}
                />
            </div>
          ))}
          </>
          )}
        </Panel>

        {showAnalysisPanel && (
            <Panel position="bottom-center" style={{ 
                background: 'white', 
                color: 'black', 
                padding: '10px', 
                borderRadius: '8px', 
                boxShadow: '0 4px 12px rgba(0,0,0,0.15)', 
                width: '600px', 
                maxHeight: '400px', 
                display: 'flex', 
                flexDirection: 'column',
                pointerEvents: 'all'
            }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px', borderBottom: '1px solid #eee', paddingBottom: '8px' }}>
                    <span style={{ fontWeight: 'bold', fontSize: '16px' }}>Cluster Analysis Results</span>
                    <button onClick={() => setShowAnalysisPanel(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '18px', color: '#666' }}>&times;</button>
                </div>
                <div style={{ overflowY: 'auto', flex: 1 }}>
                    {clusters.filter(c => c.size > 1).length === 0 ? (
                        <div style={{ padding: '20px', textAlign: 'center', color: '#666' }}>No isolated clusters found (everything is connected to the main graph).</div>
                    ) : (
                        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
                            <thead style={{ background: '#f4f6f9', position: 'sticky', top: 0 }}>
                                <tr>
                                    <th style={{ textAlign: 'left', padding: '8px' }}>Cluster ID</th>
                                    <th style={{ textAlign: 'left', padding: '8px' }}>Size</th>
                                    <th style={{ textAlign: 'left', padding: '8px' }}>Sample Components</th>
                                    <th style={{ textAlign: 'center', padding: '8px' }}>Action</th>
                                </tr>
                            </thead>
                            <tbody>
                                {clusters.filter(c => c.size > 1).map(cluster => (
                                    <tr key={cluster.id} style={{ borderBottom: '1px solid #eee' }} className="cluster-row">
                                        <td style={{ padding: '8px' }}>#{cluster.id}</td>
                                        <td style={{ padding: '8px', fontWeight: 'bold' }}>{cluster.size}</td>
                                        <td style={{ padding: '8px' }}>
                                            <div style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '300px' }}>
                                                {cluster.nodes.slice(0, 3).map(n => n.name).join(', ')}
                                                {cluster.size > 3 && `, +${cluster.size - 3} more`}
                                            </div>
                                        </td>
                                        <td style={{ padding: '8px', textAlign: 'center' }}>
                                            <button 
                                                onClick={() => selectCluster(cluster)}
                                                style={{ 
                                                    background: '#0176d3', 
                                                    color: 'white', 
                                                    border: 'none', 
                                                    borderRadius: '4px', 
                                                    padding: '4px 8px', 
                                                    cursor: 'pointer',
                                                    fontSize: '11px' 
                                                }}
                                            >
                                                Select Items
                                            </button>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    )}
                </div>
                <div style={{ marginTop: '10px', fontSize: '11px', color: '#666', borderTop: '1px solid #eee', paddingTop: '5px' }}>
                    * Showing groups of items that are connected to each other but isolated from the rest of the org. Ideal candidates for packaging.
                </div>
            </Panel>
        )}
      </ReactFlow>
    </div>
  );
}

function App() {
  return (
    <ReactFlowProvider>
      <AppContent />
    </ReactFlowProvider>
  );
}

export default App;
