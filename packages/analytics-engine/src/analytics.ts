const analytics = `BEGIN;

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
  blob1 TEXT,
  blob2 TEXT,
  blob3 TEXT,
  blob4 TEXT,
  blob5 TEXT,
  blob6 TEXT,
  blob7 TEXT,
  blob8 TEXT,
  blob9 TEXT,
  blob10 TEXT,
  blob11 TEXT,
  blob12 TEXT,
  blob13 TEXT,
  blob14 TEXT,
  blob15 TEXT,
  blob16 TEXT,
  blob17 TEXT,
  blob18 TEXT,
  blob19 TEXT,
  blob20 TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS {{BINDING}}_index ON {{BINDING}} (dataset, timestamp);
CREATE UNIQUE INDEX IF NOT EXISTS {{BINDING}}_index ON {{BINDING}} (dataset, index1, timestamp);

COMMIT;
`;

export default analytics;
