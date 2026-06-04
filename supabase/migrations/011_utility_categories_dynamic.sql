-- Add unit_label column so each utility category declares its own unit
ALTER TABLE expense_categories ADD COLUMN IF NOT EXISTS unit_label text;

-- Set unit labels for existing utility categories
UPDATE expense_categories SET unit_label = 'kWh'   WHERE name = 'EB (Electricity)';
UPDATE expense_categories SET unit_label = 'trips'  WHERE name = 'Sewage Tanker';
UPDATE expense_categories SET unit_label = 'KL'     WHERE name = 'Water';
UPDATE expense_categories SET unit_label = 'L'      WHERE name = 'Generator / DG Set';

-- Promote Lift Maintenance + Garden Maintenance to utility (cost-only, no unit_label)
UPDATE expense_categories SET is_utility = true WHERE name IN ('Lift Maintenance', 'Garden Maintenance');

-- Add Tank Cleaning as a new utility category
INSERT INTO expense_categories (name, budget_type, is_utility, unit_label, sort_order)
VALUES ('Tank Cleaning', 'Maintenance', true, 'cleanings', 12)
ON CONFLICT (name) DO UPDATE SET is_utility = true, unit_label = 'cleanings';
