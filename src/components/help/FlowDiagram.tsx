import { FlowNode, FlowEdge } from './helpContent'
import { cn } from '@/lib/utils'

interface Props {
  nodes: FlowNode[]
  edges: FlowEdge[]
  width?: number
}

const NODE_W = 110
const NODE_H = 48
const HGAP = 56
const VGAP = 52
const PAD = 16

function nodeColor(type: FlowNode['type']): { fill: string; stroke: string; text: string } {
  switch (type) {
    case 'start':
      return { fill: '#f3f0ff', stroke: '#7c3aed', text: '#5b21b6' }
    case 'action':
      return { fill: '#ede9fe', stroke: '#7c3aed', text: '#4c1d95' }
    case 'decision':
      return { fill: '#fef3c7', stroke: '#d97706', text: '#92400e' }
    case 'end':
      return { fill: '#d1fae5', stroke: '#059669', text: '#065f46' }
    case 'data':
      return { fill: '#e0f2fe', stroke: '#0284c7', text: '#0c4a6e' }
    default:
      return { fill: '#f1f5f9', stroke: '#64748b', text: '#1e293b' }
  }
}

function NodeShape({
  node,
  x,
  y,
}: {
  node: FlowNode
  x: number
  y: number
}) {
  const colors = nodeColor(node.type)
  const cx = x + NODE_W / 2
  const cy = y + NODE_H / 2
  const hasSubLabel = !!node.sublabel

  if (node.type === 'decision') {
    const hw = NODE_W / 2
    const hh = NODE_H / 2
    const points = `${cx},${cy - hh} ${cx + hw},${cy} ${cx},${cy + hh} ${cx - hw},${cy}`
    return (
      <g>
        <polygon
          points={points}
          fill={colors.fill}
          stroke={colors.stroke}
          strokeWidth={1.5}
        />
        <text
          x={cx}
          y={cy + (hasSubLabel ? -6 : 4)}
          textAnchor="middle"
          fill={colors.text}
          fontSize={9.5}
          fontWeight="600"
        >
          {node.label}
        </text>
        {node.sublabel && (
          <text x={cx} y={cy + 8} textAnchor="middle" fill={colors.text} fontSize={8} opacity={0.75}>
            {node.sublabel}
          </text>
        )}
      </g>
    )
  }

  if (node.type === 'start' || node.type === 'end') {
    const rx = NODE_W / 2
    const ry = NODE_H / 2 - 2
    return (
      <g>
        <ellipse
          cx={cx}
          cy={cy}
          rx={rx}
          ry={ry}
          fill={colors.fill}
          stroke={colors.stroke}
          strokeWidth={1.5}
        />
        <text
          x={cx}
          y={cy + (hasSubLabel ? -6 : 4)}
          textAnchor="middle"
          fill={colors.text}
          fontSize={9.5}
          fontWeight="600"
        >
          {node.label}
        </text>
        {node.sublabel && (
          <text x={cx} y={cy + 9} textAnchor="middle" fill={colors.text} fontSize={7.5} opacity={0.8}>
            {node.sublabel}
          </text>
        )}
      </g>
    )
  }

  if (node.type === 'data') {
    const rx = 6
    return (
      <g>
        <rect
          x={x}
          y={y}
          width={NODE_W}
          height={NODE_H}
          rx={rx}
          fill={colors.fill}
          stroke={colors.stroke}
          strokeWidth={1.5}
          strokeDasharray="4 2"
        />
        <text
          x={cx}
          y={cy + (hasSubLabel ? -6 : 4)}
          textAnchor="middle"
          fill={colors.text}
          fontSize={9.5}
          fontWeight="600"
        >
          {node.label}
        </text>
        {node.sublabel && (
          <text x={cx} y={cy + 9} textAnchor="middle" fill={colors.text} fontSize={7.5} opacity={0.8}>
            {node.sublabel}
          </text>
        )}
      </g>
    )
  }

  return (
    <g>
      <rect
        x={x}
        y={y}
        width={NODE_W}
        height={NODE_H}
        rx={8}
        fill={colors.fill}
        stroke={colors.stroke}
        strokeWidth={1.5}
      />
      <text
        x={cx}
        y={cy + (hasSubLabel ? -6 : 4)}
        textAnchor="middle"
        fill={colors.text}
        fontSize={9.5}
        fontWeight="600"
      >
        {node.label}
      </text>
      {node.sublabel && (
        <text x={cx} y={cy + 9} textAnchor="middle" fill={colors.text} fontSize={7.5} opacity={0.8}>
          {node.sublabel}
        </text>
      )}
    </g>
  )
}

function buildLayout(nodes: FlowNode[], edges: FlowEdge[]) {
  const nodeIds = nodes.map(n => n.id)

  const outEdges: Record<string, string[]> = {}
  const inEdges: Record<string, string[]> = {}
  nodeIds.forEach(id => { outEdges[id] = []; inEdges[id] = [] })
  edges.forEach(e => {
    if (outEdges[e.from]) outEdges[e.from].push(e.to)
    if (inEdges[e.to]) inEdges[e.to].push(e.from)
  })

  const roots = nodeIds.filter(id => inEdges[id].length === 0)
  if (roots.length === 0 && nodes.length > 0) roots.push(nodeIds[0])

  const cols: string[][] = []
  const visited = new Set<string>()
  let queue = [...roots]
  while (queue.length > 0) {
    cols.push([...queue])
    queue.forEach(id => visited.add(id))
    const next: string[] = []
    queue.forEach(id => {
      outEdges[id].forEach(tid => {
        if (!visited.has(tid) && !next.includes(tid)) next.push(tid)
      })
    })
    queue = next
  }

  const unvisited = nodeIds.filter(id => !visited.has(id))
  if (unvisited.length > 0) {
    unvisited.forEach((id, i) => {
      if (cols[i]) cols[i].push(id)
      else cols.push([id])
    })
  }

  const positions: Record<string, { x: number; y: number }> = {}
  cols.forEach((col, ci) => {
    col.forEach((id, ri) => {
      positions[id] = {
        x: PAD + ci * (NODE_W + HGAP),
        y: PAD + ri * (NODE_H + VGAP),
      }
    })
  })

  const maxRows = Math.max(...cols.map(c => c.length))
  const svgW = PAD * 2 + cols.length * NODE_W + (cols.length - 1) * HGAP
  const svgH = PAD * 2 + maxRows * NODE_H + (maxRows - 1) * VGAP

  return { positions, svgW, svgH }
}

export default function FlowDiagram({ nodes, edges, width }: Props) {
  const { positions, svgW, svgH } = buildLayout(nodes, edges)

  return (
    <div
      className={cn(
        'my-4 rounded-xl border border-violet-100 bg-white overflow-x-auto',
        'flex items-center justify-center p-2'
      )}
    >
      <svg
        viewBox={`0 0 ${svgW} ${svgH}`}
        width={width ?? svgW}
        height={svgH}
        style={{ maxWidth: '100%', minWidth: Math.min(svgW, 280) }}
      >
        <defs>
          <marker
            id="arrowhead"
            markerWidth="8"
            markerHeight="6"
            refX="7"
            refY="3"
            orient="auto"
          >
            <polygon points="0 0, 8 3, 0 6" fill="#7c3aed" opacity={0.7} />
          </marker>
        </defs>

        {edges.map((edge, i) => {
          const from = positions[edge.from]
          const to = positions[edge.to]
          if (!from || !to) return null

          const x1 = from.x + NODE_W
          const y1 = from.y + NODE_H / 2
          const x2 = to.x
          const y2 = to.y + NODE_H / 2

          const mx = (x1 + x2) / 2

          return (
            <g key={i}>
              <path
                d={`M ${x1} ${y1} C ${mx} ${y1} ${mx} ${y2} ${x2} ${y2}`}
                fill="none"
                stroke="#7c3aed"
                strokeWidth={1.5}
                opacity={0.5}
                markerEnd="url(#arrowhead)"
              />
              {edge.label && (
                <text
                  x={(x1 + x2) / 2}
                  y={Math.min(y1, y2) - 4}
                  textAnchor="middle"
                  fill="#6d28d9"
                  fontSize={8}
                  fontWeight="500"
                >
                  {edge.label}
                </text>
              )}
            </g>
          )
        })}

        {nodes.map(node => {
          const pos = positions[node.id]
          if (!pos) return null
          return <NodeShape key={node.id} node={node} x={pos.x} y={pos.y} />
        })}
      </svg>
    </div>
  )
}
