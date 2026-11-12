# Character inventory upload

Open your character Overview and select **Inventory**. In EverQuest run `/outputfile inventory`, choose the exported `.txt` file, and select **Preview equipped items**. Review the 23 locations and installed augments, then select **Import selected equipment**. Files are limited to 2 MiB.

Empty saved slots are selected initially. Occupied slots require an explicit replacement choice. Selecting the same item can update its augments. Empty exported locations never clear saved gear. A later manual equipment change removes the previous imported augment association from view.

The supported format is tab-separated: `Location`, `Name`, `ID`, `Count`, `Slots`. Repeated `Ear`, `Wrist`, `Fingers` records fill the first and second slots in file order. `Range` and `Power Source` map to their equipment locations. Immediately following `Location-Slot1` through `Location-Slot6` rows are installed augments. Bags, nested contents, held items, bank/shared-bank and key-ring entries do not become equipped items. Stacked ammunition still occupies one location. Invalid, duplicate or incomplete equipment records reject the whole file.

IDs resolve against the officer-uploaded catalog. Missing IDs retain the export's identity and name while unavailable stats remain unknown. Selected catalog details are cached for equipment and augments. No EQResource data or images are fetched; manual item hyperlinks remain.

Only the current approved main/alt owner with Overview or Mains write access may preview or import equipment. Officers cannot import someone else's gear. The server reparses the original text and atomically rechecks ownership, access and every selected previous item. Stale previews change nothing. Identical retries create no duplicate changes or audit entries.

Imports save selected equipment, augment IDs and one audit record. Raw inventory text, bag/bank contents and key-ring data are not stored. Imports never create loot awards, attendance or DKP and never prove an item was won through the guild.
