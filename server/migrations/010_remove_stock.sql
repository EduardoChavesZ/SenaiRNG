ALTER TABLE stock_movements RENAME TO legacy_stock_movements;

ALTER TABLE cards
  DROP COLUMN stock_current,
  DROP COLUMN stock_initial,
  DROP COLUMN max_quantity;

DELETE FROM settings WHERE key = 'low_stock_threshold';
