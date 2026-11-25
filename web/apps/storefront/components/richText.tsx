import type { ReactNode } from 'react';

/**
 * Tags the label files may use inside a heading: `<br></br>` for the design's two-line titles
 * and `<accent>` for its italic second voice. Each heading passes the accent colour it needs.
 */
export const headingTags = (accentClassName: string) => ({
  br: () => <br />,
  accent: (chunks: ReactNode) => <span className={`italic ${accentClassName}`}>{chunks}</span>,
});
