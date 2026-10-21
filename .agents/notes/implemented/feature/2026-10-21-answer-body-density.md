# Agent Note: answer-body density

Status: implemented

English | [中文](2026-10-21-answer-body-density.zh.md)

## Problem

An agent's answer in the chat surface was unbounded in three directions, while the input card, the map, and the details rail all carry explicit caps. No height limit applied to a fenced code block, and `pre` used `pre-wrap` with `break-all`, so a few hundred lines pushed the rest of the answer several screens down. Tables with four or more columns escaped the message column through a breakout rule in `AssistantMarkdown.module.css`: a negative margin plus `max-width: none` reached out to the whole transcript width and widened the column. Prose headings carried a 32px top margin and paragraphs 16px, which made a multi-heading answer read far looser than anything beside it. jsdom has no layout, and the existing tests checked DOM shape and the font-size axis only, so nothing guarded any of the three.

## Decision

**Code blocks cap themselves.** `CodeBlock.module.css` adds `max-height: var(--dsl-code-block-max-height, min(420px, 60vh))` and `overflow-y: auto` to the `pre`. The language banner is a sibling above the content node, outside that scrollport, so Copy never scrolls away with the source, and 60vh keeps one block from filling a short window. A host that already owns the viewport sets the variable to `none`; `ui-sidebar-documentpreview`'s `CodeBody.module.css` does exactly that, because the pane scrolls `[data-code-block-content]` itself and a second scrollport there would double the scrollbars for one file.

**Wide tables stay in the message column.** The `.body :global(.md-table-wide)` breakout rule is deleted (`--dsh-table-spare`, `--dsh-table-lead`, the negative margin, and `max-width: none`). The renderer's `md-table-wide` hook remains, tables still lay out at natural width, and the horizontal scroll belongs to the `.tableScroll` rule in `MarkdownText.module.css` (resting `overflow-x: auto`, with the bar revealed on hover/focus). A 1600px table used to spill past the column; now it scrolls inside it, with the column's own width and its alignment to the input card unchanged.

**Prose tightens vertically.** Heading top margins go 32px → 24px and bottom margins 16px → 12px; h4–h6 keep a 16px top margin with the bottom 16px → 8px; paragraph spacing goes 16px → 14px. This changes vertical whitespace only — no column width, type size, or line height moves.

## Alternatives considered

**Cap the prose column at a character measure (say 88ch).** Rejected for this round: it is the one change that moves visual whitespace and wrap positions, and it acts on precisely the layout the request asked to leave alone. It stays a separate decision.

**Wrap each answer in `FoldToggle`.** Rejected: `FoldToggle` currently serves the fixed-line folds in ReadBlock/DiffBlock. Folding flowing markdown needs expandable boundaries inserted into the render tree, and streaming appends would then rebuild expansion state, selection, and anchors with it. The cost does not match the benefit when a height cap already solves the screen-space problem.

**Move wide tables into the details rail.** Rejected: the table is part of the answer, so the prose would gain a "see details" gap, and that rail is per-turn rather than per-table.

**Keep the breakout and raise the column's max width.** Rejected: the breakout is the defect — one message crossing a layout boundary it has nothing to do with — and raising the cap only moves the overrun further out.

## Consequences

A long answer's height now follows its content instead of its longest code block, and several stacked blocks no longer push the footer off-screen. The cost is that a block's full contents cannot be seen at once; it scrolls first. Tables show their horizontal bar only on hover, which is the existing Chromium repaint behaviour this sheet already documents.

`tests/answer-density.client.spec.ts` guards all three as declarations: the code cap and `overflow-y`, the preview host's `--dsl-code-block-max-height: none`, the absence of every breakout element in the chat sheet, and `.tableScroll`'s in-column scroll. Of the 138 client test files and 1926 cases, 1925 pass; the one failure is `pdf-license-bundle.client.spec.ts`, which fails identically with this change stashed because it wants a pnpm pack while `npm_execpath` points at npm.
