# Dead-duplicate components — archived 2026-05

These components were superseded by `Enhanced*` / canonical variants
that the live UI actually imports. They were sitting in
`Barista Front End/src/components/` confusing greps and new readers
trying to identify which `ScheduleManagement` or `StationCapabilities`
was real.

Verified unused at archival time (Batch H of the May 2026 system audit):

| File | Superseded by |
|------|---------------|
| `ScheduleManagement.js` | `EnhancedScheduleManagement.js` |
| `StationCapabilities.js` | `EnhancedStationCapabilities.js` + `StationCapabilitiesEditor.js` |
| `InventoryManagementPanel.js` | `InventoryManagement.js` (live) + `MultiLevelInventory.js` (live) |
| `EnhancedOrganizerInterface.js` | `OrganiserInterface.js` (note: -er vs -or; the wrong-spelled one was the dead one) |
| `StationManagementPanel.js` | `StationSettings.js` |
| `dialogs/WalkInOrderDialog.simple.js` | `dialogs/WalkInOrderDialog.js` |

If any of these are ever useful again, restore individually and
re-verify what they import — some referenced helpers that have since
moved or been renamed.
