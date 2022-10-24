const ANALYTICS_ENGINE_SQL_SCHEMA = `BEGIN;

CREATE TABLE IF NOT EXISTS {{BINDING}} (
  dataset TEXT NOT NULL,
  index1 TEXT,
  timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
  _sample_interval INTEGER DEFAULT 1,
  double1 FLOAT,
  double2 FLOAT,
  double3 FLOAT,
  double4 FLOAT,
  double5 FLOAT,
  double6 FLOAT,
  double7 FLOAT,
  double8 FLOAT,
  double9 FLOAT,
  double10 FLOAT,
  double11 FLOAT,
  double12 FLOAT,
  double13 FLOAT,
  double14 FLOAT,
  double15 FLOAT,
  double16 FLOAT,
  double17 FLOAT,
  double18 FLOAT,
  double19 FLOAT,
  double20 FLOAT,
  blob1 BLOB,
  blob2 BLOB,
  blob3 BLOB,
  blob4 BLOB,
  blob5 BLOB,
  blob6 BLOB,
  blob7 BLOB,
  blob8 BLOB,
  blob9 BLOB,
  blob10 BLOB,
  blob11 BLOB,
  blob12 BLOB,
  blob13 BLOB,
  blob14 BLOB,
  blob15 BLOB,
  blob16 BLOB,
  blob17 BLOB,
  blob18 BLOB,
  blob19 BLOB,
  blob20 BLOB
);

CREATE INDEX IF NOT EXISTS {{BINDING}}_index ON {{BINDING}} (dataset, timestamp);
CREATE INDEX IF NOT EXISTS {{BINDING}}_index ON {{BINDING}} (dataset, index1, timestamp);

COMMIT;
`;

export default ANALYTICS_ENGINE_SQL_SCHEMA;
