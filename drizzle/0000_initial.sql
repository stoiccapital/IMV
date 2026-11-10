CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY,
  email text NOT NULL UNIQUE,
  display_name text NOT NULL,
  password_hash text NOT NULL,
  role text NOT NULL CHECK (role IN ('admin','editor','reviewer','reader')),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS sessions (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sessions_user_idx ON sessions(user_id);
CREATE TABLE IF NOT EXISTS catalog_versions (
  id uuid PRIMARY KEY,
  name text NOT NULL UNIQUE,
  year integer NOT NULL,
  quarter integer NOT NULL CHECK (quarter BETWEEN 1 AND 4),
  source_file_name text NOT NULL,
  source_file_sha256 text NOT NULL,
  record_count integer NOT NULL DEFAULT 0,
  kgk_code_count integer NOT NULL DEFAULT 0,
  review_note_count integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'imported',
  immutable boolean NOT NULL DEFAULT true,
  index_series_confirmed boolean NOT NULL DEFAULT false,
  index_series_id uuid,
  import_summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  imported_by uuid REFERENCES users(id),
  imported_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS catalog_import_issues (
  id uuid PRIMARY KEY,
  catalog_version_id uuid NOT NULL REFERENCES catalog_versions(id) ON DELETE CASCADE,
  severity text NOT NULL,
  code text NOT NULL,
  record_key text,
  message text NOT NULL,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS catalog_issues_version_idx ON catalog_import_issues(catalog_version_id);
CREATE TABLE IF NOT EXISTS kgk_nodes (
  id uuid PRIMARY KEY,
  catalog_version_id uuid NOT NULL REFERENCES catalog_versions(id) ON DELETE CASCADE,
  code text NOT NULL,
  outline text,
  label text NOT NULL,
  path text NOT NULL,
  parent_code text,
  level integer NOT NULL,
  UNIQUE(catalog_version_id, code)
);
CREATE TABLE IF NOT EXISTS price_items (
  id uuid PRIMARY KEY,
  catalog_version_id uuid NOT NULL REFERENCES catalog_versions(id) ON DELETE RESTRICT,
  dataset_id text NOT NULL,
  position_id text,
  kgk_code text NOT NULL,
  kgk_outline text,
  kgk_label text,
  kgk_path text,
  designation text NOT NULL,
  explanation text,
  basis text,
  unit text,
  price_type_raw text,
  price_q3_2026 numeric(20,6),
  percent_rate numeric(20,6),
  selected_period text,
  base_price numeric(20,6),
  base_price_lower numeric(20,6),
  base_index numeric(20,8),
  target_index numeric(20,8),
  escalation_factor numeric(20,10),
  source text,
  source_reference text,
  review_note text,
  index_source text,
  index_series text,
  tax_note text,
  calculation text,
  usage_classification text NOT NULL DEFAULT 'review_required',
  classification_source text,
  allowed_from_lph integer CHECK (allowed_from_lph BETWEEN 1 AND 9),
  allowed_to_lph integer CHECK (allowed_to_lph BETWEEN 1 AND 9),
  raw_snapshot jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(catalog_version_id, dataset_id)
);
CREATE INDEX IF NOT EXISTS price_items_catalog_idx ON price_items(catalog_version_id);
CREATE INDEX IF NOT EXISTS price_items_kgk_idx ON price_items(kgk_code);
CREATE INDEX IF NOT EXISTS price_items_position_idx ON price_items(position_id);
CREATE INDEX IF NOT EXISTS price_items_search_idx ON price_items USING gin (to_tsvector('simple', coalesce(dataset_id,'') || ' ' || coalesce(position_id,'') || ' ' || coalesce(designation,'') || ' ' || coalesce(explanation,'') || ' ' || coalesce(basis,'')));
CREATE TABLE IF NOT EXISTS index_series (
  id uuid PRIMARY KEY,
  name text NOT NULL,
  source text NOT NULL,
  base_year integer NOT NULL,
  version integer NOT NULL DEFAULT 1,
  approved boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(name, version)
);
CREATE TABLE IF NOT EXISTS index_values (
  series_id uuid NOT NULL REFERENCES index_series(id) ON DELETE CASCADE,
  year integer NOT NULL,
  quarter integer NOT NULL CHECK (quarter BETWEEN 1 AND 4),
  value numeric(20,8) NOT NULL,
  source_reference text,
  PRIMARY KEY(series_id, year, quarter)
);
CREATE TABLE IF NOT EXISTS unit_registry (
  id uuid PRIMARY KEY,
  unit text NOT NULL UNIQUE,
  label text NOT NULL,
  approved boolean NOT NULL DEFAULT false,
  note text,
  updated_by uuid REFERENCES users(id),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS calculation_rules (
  id uuid PRIMARY KEY,
  code text NOT NULL,
  name text NOT NULL,
  expression text NOT NULL,
  parameter_schema jsonb NOT NULL DEFAULT '{}'::jsonb,
  version integer NOT NULL DEFAULT 1,
  approved boolean NOT NULL DEFAULT false,
  note text,
  updated_by uuid REFERENCES users(id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(code, version)
);
CREATE TABLE IF NOT EXISTS projects (
  id uuid PRIMARY KEY,
  project_number text NOT NULL UNIQUE,
  name text NOT NULL,
  client text NOT NULL,
  route text,
  kilometer text,
  project_manager text NOT NULL,
  editor text NOT NULL DEFAULT 'Nicht zugewiesen',
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS project_members (
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  access_role text NOT NULL,
  PRIMARY KEY(project_id, user_id)
);
CREATE TABLE IF NOT EXISTS project_versions (
  id uuid PRIMARY KEY,
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  version_number integer NOT NULL,
  variant_name text NOT NULL DEFAULT 'Basis',
  planning_phase text NOT NULL,
  estimate_type text NOT NULL,
  price_year integer NOT NULL,
  price_quarter integer NOT NULL CHECK (price_quarter BETWEEN 1 AND 4),
  catalog_version_id uuid NOT NULL REFERENCES catalog_versions(id) ON DELETE RESTRICT,
  tax_mode text NOT NULL DEFAULT 'net',
  vat_rate numeric(6,3) NOT NULL DEFAULT 19,
  status text NOT NULL DEFAULT 'draft',
  immutable boolean NOT NULL DEFAULT false,
  checksum text,
  created_by uuid NOT NULL REFERENCES users(id),
  released_by uuid REFERENCES users(id),
  released_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(project_id, variant_name, version_number)
);
CREATE TABLE IF NOT EXISTS estimate_lines (
  id uuid PRIMARY KEY,
  project_version_id uuid NOT NULL REFERENCES project_versions(id) ON DELETE CASCADE,
  sequence integer NOT NULL,
  catalog_item_id uuid REFERENCES price_items(id) ON DELETE RESTRICT,
  catalog_snapshot jsonb,
  kgk_code text NOT NULL,
  kgk_path text,
  kgk_outline text,
  position_id text,
  designation text NOT NULL,
  explanation text,
  basis text,
  quantity numeric(20,6),
  unit text,
  original_unit_price numeric(20,6),
  indexed_unit_price numeric(20,6),
  manual_unit_price numeric(20,6),
  manual_price_source text,
  manual_price_date text,
  manual_price_reason text,
  manual_price_editor text,
  price_type text NOT NULL,
  percent_rate numeric(20,6),
  reference_kind text,
  reference_id text,
  factor numeric(20,8) NOT NULL DEFAULT 1,
  calculation_rule text,
  calculation_parameters jsonb,
  calculation_formula text,
  total numeric(20,2),
  source text,
  source_reference text,
  review_note text,
  review_note_status text NOT NULL DEFAULT 'open',
  own_note text,
  usage_classification text NOT NULL DEFAULT 'review_required',
  planning_phase_allowed boolean,
  negative_confirmed boolean NOT NULL DEFAULT false,
  negative_reason text,
  work_status text NOT NULL DEFAULT 'open',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(project_version_id, sequence)
);
CREATE INDEX IF NOT EXISTS estimate_lines_version_idx ON estimate_lines(project_version_id);
CREATE INDEX IF NOT EXISTS estimate_lines_kgk_idx ON estimate_lines(kgk_code);
CREATE TABLE IF NOT EXISTS audit_log (
  id uuid PRIMARY KEY,
  actor_user_id uuid REFERENCES users(id),
  project_id uuid REFERENCES projects(id) ON DELETE SET NULL,
  project_version_id uuid REFERENCES project_versions(id) ON DELETE SET NULL,
  entity_type text NOT NULL,
  entity_id text NOT NULL,
  action text NOT NULL,
  old_value jsonb,
  new_value jsonb,
  reason text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS audit_project_version_idx ON audit_log(project_version_id);
CREATE INDEX IF NOT EXISTS audit_entity_idx ON audit_log(entity_type, entity_id);

-- Additive upgrades keep existing local/production databases compatible with this initial migration.
ALTER TABLE catalog_versions ADD COLUMN IF NOT EXISTS index_series_id uuid;
ALTER TABLE price_items ADD COLUMN IF NOT EXISTS allowed_from_lph integer;
ALTER TABLE price_items ADD COLUMN IF NOT EXISTS allowed_to_lph integer;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS editor text NOT NULL DEFAULT 'Nicht zugewiesen';
CREATE INDEX IF NOT EXISTS price_items_classification_idx
  ON price_items(catalog_version_id, usage_classification, allowed_from_lph, allowed_to_lph);
CREATE INDEX IF NOT EXISTS price_items_search_v2_idx ON price_items USING gin (
  to_tsvector('simple',
    coalesce(dataset_id,'') || ' ' || coalesce(position_id,'') || ' ' || coalesce(kgk_code,'') || ' ' ||
    coalesce(kgk_label,'') || ' ' || coalesce(kgk_path,'') || ' ' || coalesce(designation,'') || ' ' ||
    coalesce(explanation,'') || ' ' || coalesce(basis,'') || ' ' || coalesce(source,'') || ' ' ||
    coalesce(source_reference,'') || ' ' ||
    coalesce(raw_snapshot->>'EPK_Quellcodes','')
  )
);
INSERT INTO unit_registry (id,unit,label,approved,note)
SELECT (
  substr(md5('unit:' || source.unit),1,8) || '-' || substr(md5('unit:' || source.unit),9,4) || '-' ||
  substr(md5('unit:' || source.unit),13,4) || '-' || substr(md5('unit:' || source.unit),17,4) || '-' ||
  substr(md5('unit:' || source.unit),21,12)
)::uuid,
source.unit,source.unit,false,'Aus vorhandenem Katalogbestand erkannt; fachliche Freigabe ausstehend'
FROM (SELECT DISTINCT trim(unit) AS unit FROM price_items WHERE nullif(trim(unit),'') IS NOT NULL) source
ON CONFLICT (unit) DO NOTHING;
