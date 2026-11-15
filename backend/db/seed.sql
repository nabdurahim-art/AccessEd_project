-- Starting data for development and the pilot. Safe to run once after schema.sql.

-- Courses are created by tools/publish.py from the content/ folder.

INSERT INTO badges (name, criteria) VALUES
  ('First Step',    'Complete your first module'),
  ('Quiz Starter',  'Pass your first quiz'),
  ('Fast Learner',  'Complete 5 modules in one day'),
  ('Week Streak',   'Study 7 days in a row');

-- To make the first admin: register an account through the app, then run
--   UPDATE users SET role = 'admin' WHERE username = 'yourusername';
