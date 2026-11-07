import React, { useState, useEffect } from 'react';
import { StyleSheet, Text, View, ScrollView, TouchableOpacity, SafeAreaView, Platform, TextInput } from 'react-native';
import {
  initDatabase,
  saveCourses,
  saveCoursePacks,
  getDB,
  getCourses,
  getPacksForCourse,
  getPack,
  getModules,
  saveLocalProgress,
  saveLocalQuizAttempt,
  getUnsyncedCount,
} from './src/db';
import { cleanupLeftovers, verifyInstalledPacks, downloadPack, packFileUri, readPackText } from './src/downloader';
import { registerOfflineShell } from './src/offlineShell';
import { request } from './src/api';
import { refreshSummary, syncAndRefresh, describeSummary } from './src/summary';
import { saveToken } from './src/session';

// TEST SCREEN ONLY. Do not commit this file.
export default function App() {
  const [log, setLog] = useState(['App started. Ready for testing.']);
  const [identifier, setIdentifier] = useState('abdurahim');
  const [password, setPassword] = useState('');
  const [progress, setProgress] = useState('');

  // Create the tables as soon as the app opens, so no button hits a missing table.
  useEffect(() => {
    initDatabase().catch((err) => console.error('initDatabase failed:', err));
    // Browser only: lets the app open with no internet. Does nothing on the phone.
    registerOfflineShell().then((r) => {
      if (r) setLog((prev) => [`Offline shell: ${r}`, ...prev]);
    });
  }, []);

  const show = (msg) => {
    const timestamp = new Date().toLocaleTimeString();
    const formatted = typeof msg === 'object' ? JSON.stringify(msg, null, 2) : msg;
    setLog((prev) => [`[${timestamp}] ${formatted}`, ...prev]);
  };

  const run = async (name, fn) => {
    show(`Running: ${name}...`);
    try {
      const result = await fn();
      if (result !== undefined) {
        show(`Success [${name}]:\n${typeof result === 'object' ? JSON.stringify(result, null, 2) : result}`);
      } else {
        show(`Success: ${name}`);
      }
    } catch (err) {
      let errDetails = `Error in ${name}: ${err.message}`;
      if (err.status) errDetails += ` | Status: ${err.status}`;
      if (err.code) errDetails += ` | Code: ${err.code}`;
      if (err.offline !== undefined) errDetails += ` | Offline: ${err.offline}`;
      show(errDetails);
      // The first lines of the stack show where it failed, without a red screen.
      show(String(err.stack || err).split('\n').slice(0, 6).join('\n'));
    }
  };

  // 1. Create tables, clean leftovers, verify installed packs.
  const handleButton1 = () => {
    run('Button 1: Init DB, Cleanup & Verify', async () => {
      show('Initializing database and schema migrations...');
      await initDatabase();

      show('Cleaning up leftover download files...');
      await cleanupLeftovers();

      show('Verifying installed packs...');
      const verifyResult = await verifyInstalledPacks();

      const db = await getDB();
      const versionRes = await db.getFirstAsync('PRAGMA user_version;');

      return {
        user_version: versionRes ? Object.values(versionRes)[0] : null,
        verifyResult,
      };
    });
  };

  // 2. Log in and keep the token.
  const handleButton2 = () => {
    run('Button 2: Login', async () => {
      const who = identifier.trim();
      show(`Authenticating as "${who}"...`);
      const reply = await request('POST', '/auth/login', { identifier: who, password });

      show(`Response keys: ${Object.keys(reply).join(', ')}`);

      const token = reply.token || reply.access_token;
      if (token) {
        await saveToken(token);
      } else {
        show('WARNING: no token field found in the reply');
      }

      // Never show the token in the log.
      const masked = { ...reply };
      if (masked.token) masked.token = 'xxx';
      if (masked.access_token) masked.access_token = 'xxx';
      return masked;
    });
  };

  // 3. Load the course list and the packs of each course from the server.
  const handleButton3 = () => {
    run('Button 3: Load Catalogue', async () => {
      show('Fetching courses from server...');
      const res = await request('GET', '/content/courses');
      const courses = res.courses || [];
      await saveCourses(courses);

      let totalPacks = 0;
      for (const c of courses) {
        show(`Fetching packs for course ID ${c.course_id} (${c.title})...`);
        const p = await request('GET', `/content/courses/${c.course_id}/packs`);
        const packs = p.packs || [];
        await saveCoursePacks(c.course_id, packs);
        totalPacks += packs.length;
      }

      return {
        courses_loaded: courses.length,
        total_packs_loaded: totalPacks,
      };
    });
  };

  // 4. Show the packs saved on the phone and their state.
  const handleButton4 = () => {
    run('Button 4: Show packs', async () => {
      const courses = await getCourses();
      if (courses.length === 0) return 'No courses saved. Run buttons 2 and 3 first.';

      const lines = [];
      for (const c of courses) {
        const packs = await getPacksForCourse(c.course_id);
        for (const p of packs) {
          lines.push(
            `pack ${p.pack_id} | ${c.title} | week ${p.week_number} | ${p.title} | v${p.version} | downloaded v${p.downloaded_version ?? '-'} | ${p.state}`
          );
        }
      }
      return lines.length ? lines.join('\n') : 'No packs saved. Run button 3 first.';
    });
  };

  // 5. Download pack 1: checksum, safe unzip, install.
  const handleButton5 = () => {
    run('Button 5: Download pack 1', async () => {
      const pack = await getPack(1);
      if (!pack) return 'Pack 1 not found. Run buttons 2 and 3 first.';

      setProgress('Starting download...');
      try {
        await downloadPack(pack, (p) => setProgress('Progress: ' + JSON.stringify(p)));
      } finally {
        // Keep the last progress line visible, but mark it finished.
        setProgress((prev) => (prev ? prev + ' (finished)' : ''));
      }

      const after = await getPack(1);
      return `Downloaded OK. state=${after.state}, downloaded_version=${after.downloaded_version}, folder=${after.local_path}`;
    });
  };

  // 6. Show the lessons of pack 1 saved from its manifest.
  const handleButton6 = () => {
    run('Button 6: Show lessons', async () => {
      const mods = await getModules(1);
      if (mods.length === 0) return '0 lessons. Download pack 1 first (button 5).';
      return (
        `${mods.length} lessons\n` +
        mods.map((m) => `${m.module_key} | ${m.title} | file: ${m.body_file} | quiz: ${m.quiz ? 'yes' : 'no'}`).join('\n')
      );
    });
  };

  // 9. Read a lesson file from the phone's own storage (works with no signal).
  const handleButton9 = () => {
    run('Button 9: Read a lesson from storage', async () => {
      const pack = await getPack(1);
      const mods = await getModules(1);
      const mod = mods.find((m) => m.body_file);
      if (!pack || !pack.local_path || !mod) return 'No lesson file. Download pack 1 first (button 5).';

      const uri = packFileUri(pack, mod.body_file);
      const text = await readPackText(pack, mod.body_file);
      return `${mod.module_key} | ${mod.title}\n${uri}\n\n${text.slice(0, 300)}`;
    });
  };

  // 7. Pretend the learner finished the first lesson of pack 1 and passed its quiz.
  //    This only saves on the phone. Nothing is sent until button 8.
  const handleButton7 = () => {
    run('Button 7: Save test progress', async () => {
      const mods = await getModules(1);
      if (mods.length === 0) return 'No lessons. Download pack 1 first (button 5).';
      const key = mods[0].module_key;
      await saveLocalProgress({ pack_id: 1, module_key: key, percent_complete: 100, status: 'completed' });
      await saveLocalQuizAttempt({ pack_id: 1, module_key: key, score: 85, passed: true });
      return `Saved progress and a quiz attempt for lesson "${key}". Waiting to sync: ${await getUnsyncedCount()}`;
    });
  };

  // 8. Send everything that is waiting. Works with no signal: it just says "offline".
  const handleButton8 = () => {
    run('Button 8: Sync now', async () => {
      const result = await syncAndRefresh();
      return { ...result, still_waiting: await getUnsyncedCount() };
    });
  };

  // 10. How many records are waiting to be sent.
  const handleButton10 = () => {
    run('Button 10: Unsynced count', async () => `Waiting to sync: ${await getUnsyncedCount()}`);
  };

  // 11. The learner's progress summary: fresh from the server when there is
  // signal, otherwise the last copy saved on this device.
  const handleButton11 = () => {
    run('Button 11: My progress', async () => describeSummary(await refreshSummary()));
  };

  return (
    <SafeAreaView style={styles.container}>
      <Text style={styles.header}>AccessEd Test Harness</Text>

      <View style={styles.inputContainer}>
        <TextInput
          style={styles.input}
          placeholder="Identifier (username/email)"
          value={identifier}
          onChangeText={setIdentifier}
          autoCapitalize="none"
          autoCorrect={false}
          spellCheck={false}
          autoComplete="off"
        />
        <TextInput
          style={styles.input}
          placeholder="Password"
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          autoCapitalize="none"
          autoCorrect={false}
          spellCheck={false}
          autoComplete="off"
        />
      </View>

      <View style={styles.buttonContainer}>
        <TouchableOpacity style={styles.button} onPress={handleButton1}>
          <Text style={styles.buttonText}>1. Init DB & Cleanup</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.button, styles.buttonSecondary]} onPress={handleButton2}>
          <Text style={styles.buttonText}>2. Login</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.button, styles.buttonSuccess]} onPress={handleButton3}>
          <Text style={styles.buttonText}>3. Load Catalogue</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.button, styles.buttonOrange]} onPress={handleButton4}>
          <Text style={styles.buttonText}>4. Show packs</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.button, styles.buttonRed]} onPress={handleButton5}>
          <Text style={styles.buttonText}>5. Download pack 1</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.button, styles.buttonOrange]} onPress={handleButton6}>
          <Text style={styles.buttonText}>6. Show lessons</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.button, styles.buttonTeal]} onPress={handleButton9}>
          <Text style={styles.buttonText}>9. Read a lesson</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.button, styles.buttonOrange]} onPress={handleButton7}>
          <Text style={styles.buttonText}>7. Save test progress</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.button, styles.buttonRed]} onPress={handleButton8}>
          <Text style={styles.buttonText}>8. Sync now</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.button, styles.buttonTeal]} onPress={handleButton10}>
          <Text style={styles.buttonText}>10. Unsynced count</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.button, styles.buttonSuccess]} onPress={handleButton11}>
          <Text style={styles.buttonText}>11. My progress</Text>
        </TouchableOpacity>
      </View>

      {progress ? <Text style={styles.progress}>{progress}</Text> : null}

      <Text style={styles.logHeader}>Execution Log:</Text>
      <ScrollView style={styles.logBox}>
        {log.map((item, index) => (
          <Text key={index} style={styles.logText}>{item}</Text>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f5f5f5', padding: 16, paddingTop: 40 },
  header: { fontSize: 20, fontWeight: 'bold', marginBottom: 12, textAlign: 'center', color: '#333' },
  inputContainer: { marginBottom: 12 },
  input: { backgroundColor: '#fff', borderWidth: 1, borderColor: '#ccc', borderRadius: 8, padding: 10, marginBottom: 8, fontSize: 14 },
  buttonContainer: { marginBottom: 8, flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between' },
  button: { backgroundColor: '#007AFF', padding: 12, borderRadius: 8, width: '49%', marginBottom: 6, alignItems: 'center' },
  buttonSecondary: { backgroundColor: '#5856D6' },
  buttonSuccess: { backgroundColor: '#34C759' },
  buttonOrange: { backgroundColor: '#FF9500' },
  buttonRed: { backgroundColor: '#FF3B30' },
  buttonTeal: { backgroundColor: '#30B0C7' },
  buttonText: { color: '#fff', fontSize: 13, fontWeight: '600' },
  progress: { fontSize: 12, color: '#333', marginBottom: 6 },
  logHeader: { fontSize: 16, fontWeight: '600', marginBottom: 4, color: '#333' },
  logBox: { flex: 1, backgroundColor: '#000', padding: 12, borderRadius: 8 },
  logText: { color: '#00FF00', fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace', fontSize: 12, marginBottom: 4 },
});
