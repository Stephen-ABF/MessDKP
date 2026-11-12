ALTER TABLE item_references ADD COLUMN full_details_json TEXT;
ALTER TABLE item_references ADD COLUMN icon_url TEXT;
ALTER TABLE item_references ADD COLUMN metadata_complete INTEGER NOT NULL DEFAULT 0 CHECK(metadata_complete IN (0,1));
ALTER TABLE item_references ADD COLUMN source_status_json TEXT;
