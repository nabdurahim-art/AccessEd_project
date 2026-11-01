-- Starting data for development and the pilot. Safe to run once after schema.sql.

INSERT INTO courses (title, subject, language, description) VALUES
  ('Literacy Basics',   'Literacy',    'en', 'Reading and writing for beginners'),
  ('Everyday Maths',    'Mathematics', 'en', 'Numbers and simple calculations'),
  ('Life Skills',       'Life skills', 'en', 'Money, health and safety in daily life');

INSERT INTO badges (name, criteria) VALUES
  ('First Step',    'Complete your first module'),
  ('Quiz Starter',  'Pass your first quiz'),
  ('Fast Learner',  'Complete 5 modules in one day'),
  ('Week Streak',   'Study 7 days in a row');

-- To make the first admin: register an account through the app, then run
--   UPDATE users SET role = 'admin' WHERE username = 'yourusername';
