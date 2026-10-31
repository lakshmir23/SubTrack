---
version: alpha
name: SubTrack
description: Brightloop's precise, calm subscription operations workspace.
colors:
  primary: "#234A73"
  primary-hover: "#173B60"
  ink: "#192B3D"
  secondary: "#566777"
  background: "#F2F5F8"
  surface: "#FFFFFF"
  subtle: "#E9F0F7"
  border: "#D5DFE8"
  control-border: "#788B9D"
  selection: "#D5E5F5"
  input-hover: "#234A73"
  requirement-pending: "#7E8D9B"
  trail-line: "#AFC2D6"
  trail-node: "#D7E4F0"
  success: "#17654E"
  success-soft: "#E7F3ED"
  danger: "#AA3441"
  danger-soft: "#FCEFF0"
  warning: "#855916"
  warning-soft: "#FFF6E5"
  focus: "#386DA3"
typography:
  display:
    fontFamily: "Manrope, sans-serif"
  sans:
    fontFamily: "DM Sans, sans-serif"
rounded:
  DEFAULT: "0.5rem"
  sm: "0.375rem"
  md: "0.5rem"
  lg: "0.875rem"
  brand: "11px"
  pill: "20px"
  compact-panel: "12px"
  icon: "10px"
spacing:
  section-gap: "2rem"
  page-max: "76rem"
components:
  button:
    {
      height: "2.75rem",
      backgroundColor: "{colors.primary}",
      textColor: "{colors.surface}",
    }
  button-hover: { backgroundColor: "{colors.primary-hover}" }
  input: { height: "2.875rem", textColor: "{colors.ink}" }
  input-hover: { textColor: "{colors.input-hover}" }
  panel: { rounded: "{rounded.lg}", backgroundColor: "{colors.surface}" }
  divider: { backgroundColor: "{colors.border}" }
  focus-indicator: { backgroundColor: "{colors.focus}" }
  info: { backgroundColor: "{colors.subtle}", textColor: "{colors.primary}" }
  success:
    { backgroundColor: "{colors.success-soft}", textColor: "{colors.success}" }
  danger:
    { backgroundColor: "{colors.danger-soft}", textColor: "{colors.danger}" }
  warning:
    { backgroundColor: "{colors.warning-soft}", textColor: "{colors.warning}" }
  selection: { backgroundColor: "{colors.selection}" }
  requirement-pending: { textColor: "{colors.requirement-pending}" }
  trail-line: { backgroundColor: "{colors.trail-line}" }
  trail-node: { backgroundColor: "{colors.trail-node}" }
  control-boundary: { backgroundColor: "{colors.control-border}" }
---

# SubTrack Design System

## Overview

### Creative North Star

A signed agreement's traceable trail: calm blue working surfaces, a continuous loop brand, deliberate alignment and clear ownership. This is an operating tool for Brightloop's staff and customers. Information, permissions and the next honest action lead every surface. The category's generic KPI dashboard and a decorative finance terminal are anti-references.

The brief supplies English software operations and local resilience; INR and Asia/Kolkata are implementation policy, not a claimed market study. The main usage scene is daily desktop work with a narrow-screen record-check path. Register is product throughout. No Japan-market scope is established.

The root task authorizes a new product, with no incumbent visual identity. The task-derived direction is the agreement trail; blue, white and precise type carry forward into later gates. One signature, quiet surroundings. Do not build empty navigation for future gates.

Token ownership: this file defines the visual contract; `src/styles.css` maps the named values one-to-one to `--color-*` custom properties. No framework adapter or generated theme exists. Shared components consume these variables. Change both sources together and use the strict premium audit plus browser screenshots to inspect drift.

## Colors

Primary blue owns actions and selected navigation. Ink owns headings; secondary text remains readable against background and white. White working panels and blue-gray page ground separate information without ornamental shadows. Border is for quiet row separation; control-border defines input and search boundaries at greater than 3:1 against white. Input hover uses primary blue. Selection, pending-requirement and the two trail tints are intentionally recorded variants of this same blue-gray world, consumed through matching CSS variables. Success, warning and danger always pair an icon or text with color. Focus is a visible 3px outline. Light is the current theme. Forced colors defer to system colors.

## Typography

Self-hosted Manrope headings at 600–700 give the product its compact, measured identity. DM Sans at 400–600 serves copy, labels and tables. Body is 15–16px at 1.6 line height; titles range 26–40px and use no less than -0.03em tracking. Use tabular numerals for data; no decorative monospace. Dates use English (India), with explicit business-date or timestamp semantics. Headings use sentence case; body measure is no more than 68ch.

## Layout

The desktop shell has a 232px sidebar and a max-76rem content region. A top identity bar separates scope from work. The authentication split gives the task roughly half the width and uses the adjacent side for concise real workflow context. At 800px the sidebar becomes a horizontal header/navigation row; at 600px forms and lists occupy one column with 20px page padding. Document scrolling is canonical. Tables scroll horizontally within their own region only when necessary; no fixed-height shell can clip a long form. Forms retain error/help space, and loaders reserve the same working region.

## Elevation & Depth

Surface tone and restrained one-pixel boundaries establish rank. No shadow on every card. Only transient overlays may use a soft offset shadow. There is no blur or glass. Async feedback appears inside a reserved region rather than moving the primary action.

## Shapes

Panels use the 14px large radius, inputs 8px, buttons 8px. Pills are reserved for small role/status chips. The loop mark is geometric identity, never a decorative illustration. Dividers are thin and aligned with content edges.

## Components

### Foundational visual states

Buttons and links have visible hover, pressed and focus states. Disabled controls have reduced emphasis and never masquerade as available actions. Loading uses the shared spinner plus a textual explanation in a stable region. Failure is inline with a safe retry. Empty states name what is missing and offer the permitted next action. Success uses the shared live status region; it does not replace persisted detail.

### Buttons and actions

One solid blue primary action per task; neutral outlined or text secondary actions. Danger is reserved for destructive behavior. Controls are at least 44px tall. Busy labels keep button dimensions stable. Lucide icons are 18–20px, stroke width 1.75, aligned with text. Standalone icons always have an accessible label.

### Navigation and data display

Sidebar links use quiet blue selected surfaces and exact destination labels. Role scope remains visible. Native semantic tables have readable aligned headings, server pagination and a truthful row count. A row's primary name is a link only when a detail destination exists. Narrow layouts retain all actions and full email values. Do not draw placeholder charts or fabricated business totals.

### Forms and overlays

Shared Field and PasswordField own label/error association, invalid state and show/hide. Product forms use noValidate, schema validation, first-invalid focus and preserved input. A shared pending state prevents double-submit. Passwords remain masked by default; passwords and tokens never enter persistent client storage. Search includes a clear button, URL state, 300ms debounce and stale-request cancellation. No select or calendar is needed in P0/P1. No browser dialogs are allowed.

### Iconography

Lucide outlines are the only pictorial icon family. The custom SVG loop is the only brand exception. Icons support text; they do not replace a financial state label.

### Motion

Short 140ms state transitions communicate focus/hover; a loader rotates only while a request is in flight. There are no decorative entry cascades. Reduced motion removes transition and rotation; a static loading label remains.

### Content and data visualization

Plain sentence case, specific errors and action verbs. Do not claim email arrival from message generation, or core workflow completion from P1. Local fixtures are labeled synthetic. INR formatting uses `Intl.NumberFormat`; amounts and dates remain server-authoritative. No graph exists until real related records are implemented.

## Do's and Don'ts

- Do show who can act and what happened, using persisted data.
- Do keep create/read/search feedback and focus consistent across sibling staff/customer lists.
- Don't fill future navigation with dead buttons or synthetic operational claims.
- Don't add decoration that obscures identity, permission or financial information.
