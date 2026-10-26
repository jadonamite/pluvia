# Interface foundations

Pluvia is a desktop claims desk with a stacked layout on phones. The inbox leads to one claim, its daily rainfall evidence, and the code-gated decision. The chart is the main visual. No decorative imagery or icon grid competes with the evidence.

Structure, input behaviour, and accessibility follow the local Apple HIG web translation. The warm paper surface and brown accent give the product its own identity. Content uses opaque surfaces; there is no simulated glass.

The system font stack serves no remote font requests. Type roles use the HIG web scale: title 2 at 1.75rem/1.09, title 3 at 1.1875rem/1.13, body and headline at 1rem/1.16, caption at .875rem/1.18, footnote at .75rem/1.21. Reading text opens to 1.5 line height. Chart ticks use 12px as a canvas rendering minimum. Amounts use the title scale and tabular numerals.

Spacing uses the derived 4px scale: 4, 8, 12, 16, 20, 24, 32, 40, 48, 64. Touch hit regions are at least 44 CSS pixels in both dimensions. Focus rings remain visible. Browser zoom is unrestricted, and layout wraps at narrow widths.

Light roles: label #221814, secondary label #67544c, background #fff4f1, surface #f5eae7, paper #fffaf8, primary #9e5f4a, on-primary #ffffff, evidence accent #3b7e5b, separator #e4dad7. Dark roles: label #fdeee9, secondary label #c7ada3, background #0e0806, surface #191310, paper #211a17, primary #a46450, on-primary #ffffff, evidence accent #6caf8a, separator #51413b. Green is used for plotted evidence, not light-surface body copy. Meaning is always written as text as well as colour.

Radius steps: 4px for labels, 8px for controls, 12px for compact grouped surfaces. Content sections primarily use rules, not floating cards. Elevation is zero for desk content; the legal dialog alone uses an elevated shadow. Motion: 160ms ease-out opacity on claim-panel changes, 120ms colour feedback on controls, a 240ms chart reveal on loaded evidence. Reduced motion disables animation. Reduced transparency uses the same opaque surfaces.

Daily station bars and satellite lines share a millimetre axis. Missing, duplicate, flagged and fill records are unavailable, never plotted as zero; a hatched strip marks unavailable station days. The daily data table carries the same values and flags. Cumulative thresholds are deliberately omitted from the daily chart. Decisions and amounts come from the API, never from chart calculations. Feedback stores a memory assessment and never changes the decision or amount.

Policies, claims, and money are labelled synthetic. Runtime mode is reported from the health endpoint. Model responses render as text, including letters and SQL. No analytics, third-party fonts, or persistent browser storage is used; the notice dismissal and theme preference last for the current tab session. Chart.js is the single pinned external runtime asset.
