declare module 'refractor/mermaid' {
  import type { Syntax } from 'refractor/core'

  const mermaid: Syntax
  export default mermaid
}

declare module 'refractor/latex' {
  import type { Syntax } from 'refractor/core'

  const latex: Syntax
  export default latex
}
