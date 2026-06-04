-- Gap analysis: add missing expense categories for apartment maintenance

INSERT INTO expense_categories (name, budget_type, is_utility, sort_order) VALUES
  ('Pest Control',       'Maintenance', false, 15),
  ('Insurance',          'Maintenance', false, 16),
  ('Fire Safety',        'Maintenance', false, 17),
  ('CCTV & Intercom',    'Maintenance', false, 18),
  ('Audit & Accounting', 'Maintenance', false, 19),
  -- Corpus additions
  ('Electrical Rewiring','Corpus',      false, 23),
  ('Solar Installation', 'Corpus',      false, 24),
  ('Flooring',           'Corpus',      false, 25)
ON CONFLICT (name) DO NOTHING;
