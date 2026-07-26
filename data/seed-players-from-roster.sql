Delete from players where 1=1;

WITH roster(name) AS (VALUES
  ('Aatif'),
  ('Hassan'),
  ('Sohail'),
  ('Abbas'),
  ('Hassaan'),
  ('Abdullah Abbasi'),
  ('Ahsan'),
  ('Aamir Saleem'),
  ('Noman'),
  ('Majed'),
  ('Arsalan'),
  ('Bilal Pk'),
  ('Tahir'),
  ('Aamer Riaz'),
  ('Nashib'),
  ('Mujahid')
),
prepared AS (
  SELECT
    name,
    'p_' || substr(md5(lower(trim(name))), 1, 12) AS pid,
    (extract(epoch FROM now()) * 1000)::bigint AS ts
  FROM roster
)
INSERT INTO players (id, data, updated_at)
SELECT
  pid,
  jsonb_build_object(
    'id', pid,
    'name', name,
    'createdAt', ts,
    'updatedAt', ts,
    'batting', jsonb_build_object(
      'matches', 0, 'innings', 0, 'notOuts', 0, 'runs', 0, 'balls', 0,
      'highest', 0, 'fifties', 0, 'hundreds', 0, 'ducks', 0, 'fours', 0, 'sixes', 0
    ),
    'bowling', jsonb_build_object(
      'matches', 0, 'innings', 0, 'balls', 0, 'runs', 0, 'wickets', 0,
      'bestWickets', 0, 'bestRuns', null, 'threeWickets', 0, 'fiveWickets', 0
    )
  ),
  now()
FROM prepared
WHERE NOT EXISTS (
  SELECT 1 FROM players p
  WHERE p.id <> '_quickcric:meta'
    AND lower(trim(regexp_replace(p.data->>'name', '\s+', ' ', 'g'))) = lower(trim(prepared.name))
);
