# Security policy

Sepia's whole job is safety, so reports get taken seriously and answered
fast.

## Reporting

Email Munzzyy1@proton.me, or use GitHub's private vulnerability reporting on
this repository. You will get an answer within 72 hours.

Especially interested in:

- Any way metadata or image content survives an export that the verify step
  does not report (this is the core promise; treat any counterexample as
  critical).
- Redactions that are recoverable from the output file.
- Any network traffic from the app at all.
- Parser crashes or hangs on hostile image files.

## Scope notes

- The X-ray on the *original* file is informational; completeness bugs there
  are wanted reports but the scrub does not rely on it.
- Pixelation reversal on text is a documented limitation, not a
  vulnerability; the UI already steers text redaction to ink.
- Pixel-content leaks (faces, reflections, sensor fingerprints) are outside
  what any scrubber can fix and are documented in the threat model.

## No bounty

There is no money behind this project. What you get is a fast fix, credit in
the changelog if you want it, and a tool that stays trustworthy.
