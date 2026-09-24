# Day 2 — V1 visual design port (replacement for rejected generic-shell patch)

- Baseline: V2 Day1 source in ALL_IN_ONE_HANDOFF, not the unverified current PC.
- Source: actual V1 admin/student/teacher/supervisor templates and component SCSS from nested V1 reference ZIP.
- All changes are Frontend or docs/tests only; no backend, migration, SQL or auth service edits.
- V1 stays read-only. Routes preserved from previously created shells plus original V1 admin report/weekly summary shells.
- V1 admin: 260px right sidebar, 64px header, exact V1 markup skeleton and SCSS.
- V1 student: TOP navigation + mobile BOTTOM navigation, not an Admin-like sidebar. V1 SCSS and template structure retained.
- V1 teacher: white 270px sidebar and 6-item mobile bar; supervisor: dark-green 270px sidebar.
- V1 references use FontAwesome for some icons, but V2 has no FontAwesome dependency. Material Symbols are used to avoid a new runtime dependency; these icons are not pixel-identical to V1.
- V1 static A1 level was deliberately not asserted, and V1 user data bindings were removed because V2 Auth contract differs.
- Shell content is only an empty state; actual V1 business page content is NOT ported in this foundation patch.
- Must run full Angular build and browser visual comparison on user's actual Windows project before calling visual parity verified.
- Restore Day1 via Git first; do not overlay on rejected patch; no database update or provisioning.
