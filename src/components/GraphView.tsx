import React, { useEffect, useRef, useState } from 'react';
import * as d3 from 'd3';
import { Note, GraphNode, GraphLink } from '../types';
import { getNoteLinks } from '../services/storage';

interface GraphViewProps {
  notes: Note[];
  onNodeClick: (noteId: string) => void;
}

const GraphView: React.FC<GraphViewProps> = ({ notes, onNodeClick }) => {
  const svgRef = useRef<SVGSVGElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [dimensions, setDimensions] = useState({ width: 800, height: 600 });

  // Handle Resize
  useEffect(() => {
    if (!containerRef.current) return;
    
    const observer = new ResizeObserver((entries) => {
      for (let entry of entries) {
        if (entry.contentRect.width > 0 && entry.contentRect.height > 0) {
          setDimensions({
            width: entry.contentRect.width,
            height: entry.contentRect.height
          });
        }
      }
    });
    
    observer.observe(containerRef.current);
    
    if (containerRef.current.clientWidth > 0 && containerRef.current.clientHeight > 0) {
      setDimensions({
        width: containerRef.current.clientWidth,
        height: containerRef.current.clientHeight
      });
    }

    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!svgRef.current || notes.length === 0) return;

    // Prepare data
    const nodes: GraphNode[] = notes.map(n => ({
      id: n.id,
      title: n.title,
      group: 1,
      // Initial random position to help stabilization
      x: dimensions.width / 2 + (Math.random() - 0.5) * 50,
      y: dimensions.height / 2 + (Math.random() - 0.5) * 50
    }));

    const rawLinks = getNoteLinks(notes);
    const links: GraphLink[] = rawLinks.map(l => ({
      source: l.source,
      target: l.target
    }));

    // Clear previous
    d3.select(svgRef.current).selectAll("*").remove();

    const svg = d3.select(svgRef.current)
      .attr("viewBox", [0, 0, dimensions.width, dimensions.height])
      .style("font-family", "sans-serif");

    // Add zoom
    const g = svg.append("g");
    const zoom = d3.zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.1, 4])
      .on("zoom", (event) => {
        g.attr("transform", event.transform);
      });
    svg.call(zoom);

    // Simulation
    const simulation = d3.forceSimulation<GraphNode>(nodes)
      .force("link", d3.forceLink<GraphNode, GraphLink>(links).id(d => d.id).distance(100))
      .force("charge", d3.forceManyBody().strength(-300))
      .force("center", d3.forceCenter(dimensions.width / 2, dimensions.height / 2))
      .force("collide", d3.forceCollide().radius(30));

    // Links
    const link = g.append("g")
      .attr("stroke", "#555")
      .attr("stroke-opacity", 0.6)
      .selectAll("line")
      .data(links)
      .join("line")
      .attr("stroke-width", 1.5);

    // Nodes (Circles)
    const node = g.append("g")
      .attr("stroke", "#fff")
      .attr("stroke-width", 1.5)
      .selectAll("g")
      .data(nodes)
      .join("g")
      .call(d3.drag<SVGGElement, GraphNode>()
        .on("start", dragstarted)
        .on("drag", dragged)
        .on("end", dragended));

    node.append("circle")
      .attr("r", 8)
      .attr("fill", "#7c3aed") // Accent color
      .attr("cursor", "pointer")
      .on("click", (event, d) => {
        if (event.defaultPrevented) return;
        event.stopPropagation();
        onNodeClick(d.id);
      })
      .on("touchend", (event, d) => {
        if (event.defaultPrevented) return;
        event.stopPropagation();
        event.preventDefault();
        onNodeClick(d.id);
      })
      .on("mouseover", function() { d3.select(this).attr("fill", "#a78bfa"); })
      .on("mouseout", function() { d3.select(this).attr("fill", "#7c3aed"); });

    // Node Labels
    const text = node.append("text")
      .text(d => d.title)
      .attr("x", 12)
      .attr("y", 4)
      .style("font-size", "13px")
      .style("pointer-events", "none")
      .attr("stroke", "none") // Stop inheriting white stroke from node group
      .attr("fill", "#e2e8f0"); // Use crisp text color
      
    // Add outline (stroke) for readability against lines
    text.clone(true).lower()
      .attr("fill", "none")
      .attr("stroke", "#121317") // Obsidian bg color
      .attr("stroke-width", 4) 
      .attr("stroke-linejoin", "round");

    // Simulation Tick
    simulation.on("tick", () => {
      link
        .attr("x1", d => (d.source as GraphNode).x!)
        .attr("y1", d => (d.source as GraphNode).y!)
        .attr("x2", d => (d.target as GraphNode).x!)
        .attr("y2", d => (d.target as GraphNode).y!);

      node.attr("transform", d => `translate(${d.x},${d.y})`);
    });

    // Drag functions
    function dragstarted(event: any, d: GraphNode) {
      if (!event.active) simulation.alphaTarget(0.3).restart();
      d.fx = d.x;
      d.fy = d.y;
    }

    function dragged(event: any, d: GraphNode) {
      d.fx = event.x;
      d.fy = event.y;
    }

    function dragended(event: any, d: GraphNode) {
      if (!event.active) simulation.alphaTarget(0);
      d.fx = null;
      d.fy = null;
    }

    // CLEANUP FUNCTION to stop simulation when component unmounts or updates
    return () => {
      simulation.stop();
    };

  }, [notes, dimensions, onNodeClick]);

  return (
    <div ref={containerRef} className="w-full h-full bg-transparent overflow-hidden relative">
        <div className="absolute top-4 right-4 bg-obsidian-sidebar/60 backdrop-blur-md p-2 rounded-lg text-xs text-gray-400 z-10 border border-obsidian-border/50 shadow-lg">
            {notes.length} Nodes • {getNoteLinks(notes).length} Links
        </div>
      <svg ref={svgRef} className="w-full h-full"></svg>
    </div>
  );
};

export default GraphView;