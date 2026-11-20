import type { MermaidConfig } from 'mermaid'
import { DEFAULT_MERMAID_STYLE, isMermaidStyle, type MermaidStyle } from '../../../shared/ipc'

export type DiagramTheme = 'light' | 'dark'

export function getMermaidStyle(): MermaidStyle {
  const style = document.documentElement.dataset.mermaidStyle
  return isMermaidStyle(style) ? style : DEFAULT_MERMAID_STYLE
}

const softPalettes = {
  light: {
    paper: '#f6f8fa', node: '#ffffff', process: '#eef4ff', output: '#edfaf2',
    ink: '#324058', blue: '#2450a7', green: '#286441', line: '#63758b',
    border: '#c7d2e0', blueBorder: '#95b1e3', greenBorder: '#8dbba3',
    accent: ['#7395d0', '#84b8a1', '#b39bd8', '#e2b988', '#da9ea6', '#83afca']
  },
  dark: {
    paper: '#171a20', node: '#242832', process: '#242832', output: '#242832',
    ink: '#e6ebf4', blue: '#c9d9f5', green: '#c9ecd8', line: '#96a7bd',
    border: '#586678', blueBorder: '#6b86ae', greenBorder: '#59826b',
    accent: ['#799bd5', '#82ba9d', '#b49bdd', '#d7ab78', '#d8919c', '#7caecb']
  }
}

const githubPalettes = {
  light: {
    paper: '#ffffff', node: '#f6f8fa', process: '#ddf4ff', output: '#dafbe1',
    ink: '#1f2328', blue: '#1f2328', green: '#1f2328', line: '#59636e',
    border: '#d1d9e0', blueBorder: '#0969da', greenBorder: '#1a7f37',
    attention: '#fff8c5', attentionBorder: '#9a6700',
    accent: ['#80b8ec', '#79c78a', '#d4b448', '#b69adc', '#e9979e', '#83c7d2']
  },
  dark: {
    paper: '#0d1117', node: '#161b22', process: '#122a45', output: '#153324',
    ink: '#e6edf3', blue: '#e6edf3', green: '#e6edf3', line: '#8b949e',
    border: '#30363d', blueBorder: '#58a6ff', greenBorder: '#3fb950',
    attention: '#362b15', attentionBorder: '#d29922',
    accent: ['#58a6ff', '#3fb950', '#e3b341', '#bc8cff', '#f08892', '#56d4dd']
  }
}

export function mermaidBackground(style: MermaidStyle, theme: DiagramTheme): string {
  if (style === 'soft') return softPalettes[theme].paper
  if (style === 'github') return githubPalettes[theme].paper
  if (style === 'classic-blue' && theme === 'dark') return '#0d1117'
  return '#ffffff'
}

export function mermaidConfig(style: MermaidStyle, theme: DiagramTheme): MermaidConfig {
  if (style === 'soft' || style === 'github') return themedConfig(style, theme)
  if (style === 'classic-blue') return classicBlueConfig(theme)
  return { theme: style, htmlLabels: false }
}

function themedConfig(style: 'soft' | 'github', theme: DiagramTheme): MermaidConfig {
  const github = style === 'github' ? githubPalettes[theme] : null
  const p = github ?? softPalettes[theme]
  const radius = github ? 6 : 10
  const dark = theme === 'dark'
  const themeVariables: Record<string, unknown> = {
    darkMode: dark, background: p.paper, fontFamily: 'system-ui, sans-serif', fontSize: '15px',
    primaryColor: p.node, primaryTextColor: p.ink, primaryBorderColor: p.border,
    secondaryColor: p.process, secondaryTextColor: p.ink, secondaryBorderColor: p.blueBorder,
    tertiaryColor: p.output, tertiaryTextColor: p.ink, tertiaryBorderColor: p.greenBorder,
    mainBkg: p.node, textColor: p.ink, lineColor: p.line, edgeLabelBackground: p.paper,
    clusterBkg: p.process, clusterBorder: p.border,
    actorBkg: p.node, actorBorder: p.blueBorder, actorTextColor: p.ink, actorLineColor: p.border,
    signalColor: p.line, signalTextColor: p.ink, labelBoxBkgColor: p.process,
    labelBoxBorderColor: p.blueBorder, labelTextColor: p.ink, loopTextColor: p.ink,
    noteBkgColor: p.output, noteBorderColor: p.greenBorder, noteTextColor: p.ink,
    activationBkgColor: p.process, activationBorderColor: p.blueBorder,
    titleColor: p.ink, taskBkgColor: p.process, taskBorderColor: p.blueBorder,
    taskTextColor: p.ink, taskTextOutsideColor: p.ink, taskTextDarkColor: p.ink,
    activeTaskBkgColor: p.process, activeTaskBorderColor: p.blueBorder,
    doneTaskBkgColor: p.output, doneTaskBorderColor: p.greenBorder,
    gridColor: p.border, sectionBkgColor: p.process, sectionBkgColor2: p.output,
    pieTitleTextColor: p.ink, pieLegendTextColor: p.ink, pieSectionTextColor: '#162536',
    pieStrokeColor: p.paper, pieOuterStrokeColor: p.border,
    xyChart: {
      backgroundColor: p.paper, titleColor: p.ink,
      xAxisLabelColor: p.ink, yAxisLabelColor: p.ink, plotColorPalette: p.accent.join(',')
    },
    quadrant1Fill: p.process, quadrant2Fill: p.output, quadrant3Fill: p.node, quadrant4Fill: p.paper,
    quadrant1TextFill: p.ink, quadrant2TextFill: p.ink, quadrant3TextFill: p.ink, quadrant4TextFill: p.ink,
    quadrantPointFill: p.blueBorder, quadrantPointTextFill: p.ink, quadrantTitleFill: p.ink,
    quadrantXAxisTextFill: p.ink, quadrantYAxisTextFill: p.ink
  }
  for (const [index, color] of p.accent.entries()) {
    themeVariables['pie' + (index + 1)] = color
    themeVariables['cScale' + index] = color
    themeVariables['cScaleLabel' + index] = '#162536'
    themeVariables['git' + index] = color
  }
  return {
    theme: 'base',
    htmlLabels: false,
    fontFamily: 'system-ui, sans-serif',
    themeVariables,
    flowchart: { htmlLabels: false, curve: 'basis', nodeSpacing: 40, rankSpacing: 55, padding: 12 },
    sequence: { actorMargin: 40, width: 115, height: 47 },
    themeCSS: `
      .node rect.label-container, .cluster rect, rect.actor { rx: ${radius}px; ry: ${radius}px; }
      .node tspan[font-weight="normal"] { font-weight: ${github ? 600 : 500}; }
      ${github ? `
        .node.review .label-container { fill: ${github.process}; stroke: ${github.blueBorder}; }
        .node.merged .label-container { fill: ${github.output}; stroke: ${github.greenBorder}; }
        .node.update .label-container { fill: ${github.attention}; stroke: ${github.attentionBorder}; }
      ` : ''}
      .node.default polygon.label-container { fill: ${p.process}; stroke: ${p.blueBorder}; }
      .node.process .label-container { fill: ${p.process}; stroke: ${p.blueBorder}; }
      .node.output .label-container { fill: ${p.output}; stroke: ${p.greenBorder}; }
      .node.process .label text { fill: ${p.blue}; }
      .node.output .label text { fill: ${p.green}; }
      .edgeLabel text { fill: ${p.ink}; paint-order: stroke; stroke: ${p.paper}; stroke-width: 5px; stroke-linejoin: round; }
    `
  }
}

function classicBlueConfig(theme: DiagramTheme): MermaidConfig {
  const dark = theme === 'dark'
  const ink = dark ? '#acd6ff' : '#174c78'
  const outline = dark ? '#345575' : '#bdd4e8'
  const paper = dark ? '#0d1117' : '#ffffff'
  return {
    theme: 'base',
    htmlLabels: false,
    themeCSS: `
      .node rect.label-container { rx: 12px; ry: 12px; }
      .node polygon.label-container { fill: ${dark ? '#14273a' : '#f4f9ff'}; }
      .node .label text, .node .label tspan[font-weight="normal"],
      .edgeLabel tspan[font-weight="normal"] { font-weight: 600; }
      .edgeLabel text { paint-order: stroke; stroke: ${paper}; stroke-width: 4px; stroke-linejoin: round; }
      .edgeLabel .label rect { rx: 8px; ry: 8px; }
    `,
    themeVariables: {
      darkMode: dark, background: paper,
      fontFamily: 'system-ui, sans-serif', fontSize: '14px',
      primaryColor: dark ? '#102e49' : '#e6f3ff',
      secondaryColor: dark ? '#162638' : '#f3f8fc',
      tertiaryColor: dark ? '#282c42' : '#f3f1fa',
      primaryTextColor: ink, secondaryTextColor: ink, tertiaryTextColor: ink,
      textColor: ink, primaryBorderColor: outline,
      lineColor: dark ? '#7494af' : '#7390a7',
      edgeLabelBackground: paper,
      clusterBkg: dark ? '#18232b' : '#f6f9fa',
      clusterBorder: dark ? '#43525e' : '#c8d4d9',
      actorTextColor: ink, signalTextColor: ink, signalColor: ink,
    },
    flowchart: { htmlLabels: false, curve: 'linear', nodeSpacing: 36, rankSpacing: 48, padding: 12 },
  }
}
