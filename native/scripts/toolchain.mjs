/**
 * Resolves the Android toolchain for scripted builds WITHOUT touching global settings:
 *   JAVA_HOME    <- $MINIGAMES_JAVA_HOME    | ~/dev/jdk-21        | $JAVA_HOME
 *   ANDROID_HOME <- $MINIGAMES_ANDROID_HOME | ~/dev/android-sdk   | $ANDROID_HOME | $ANDROID_SDK_ROOT
 *   proxy        <- $MINIGAMES_PROXY (e.g. http://127.0.0.1:2080, or "none")
 *                   default: http://127.0.0.1:2080 on Windows (this dev box), none elsewhere (Mac / CI)
 * Values only go into the environment of child processes.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const exists = (p) => Boolean(p) && fs.existsSync(p);
const firstExisting = (...candidates) => candidates.find(exists) || null;

export function resolveToolchain() {
  const home = os.homedir();
  const javaHome = firstExisting(process.env.MINIGAMES_JAVA_HOME, path.join(home, 'dev', 'jdk-21'), process.env.JAVA_HOME);
  const androidHome = firstExisting(
    process.env.MINIGAMES_ANDROID_HOME,
    path.join(home, 'dev', 'android-sdk'),
    process.env.ANDROID_HOME,
    process.env.ANDROID_SDK_ROOT,
  );
  if (!javaHome) throw new Error('JDK 21 not found: set MINIGAMES_JAVA_HOME or install it to ~/dev/jdk-21');
  if (!androidHome) throw new Error('Android SDK not found: set MINIGAMES_ANDROID_HOME or install it to ~/dev/android-sdk');

  const rawProxy = process.env.MINIGAMES_PROXY ?? (process.platform === 'win32' ? 'http://127.0.0.1:2080' : 'none');
  let proxy = null;
  if (rawProxy && rawProxy !== 'none') {
    const u = new URL(rawProxy);
    proxy = { url: rawProxy, host: u.hostname, port: u.port || '80' };
  }
  return { javaHome, androidHome, proxy };
}

/** JVM system properties for Gradle (wrapper download + build): JDK pin and HTTP(S) proxy. */
export function gradleSystemProps(tc) {
  const props = [`-Dorg.gradle.java.home=${tc.javaHome}`];
  if (tc.proxy) {
    const { host, port } = tc.proxy;
    props.push(`-Dhttp.proxyHost=${host}`, `-Dhttp.proxyPort=${port}`, `-Dhttps.proxyHost=${host}`, `-Dhttps.proxyPort=${port}`);
  }
  return props;
}

export function toolchainEnv(tc) {
  const sep = path.delimiter;
  const extraPath = [path.join(tc.javaHome, 'bin'), path.join(tc.androidHome, 'platform-tools'), path.join(tc.androidHome, 'cmdline-tools', 'latest', 'bin')];
  const pathKey = Object.keys(process.env).find((k) => k.toUpperCase() === 'PATH') || 'PATH';
  return {
    ...process.env,
    JAVA_HOME: tc.javaHome,
    ANDROID_HOME: tc.androidHome,
    ANDROID_SDK_ROOT: tc.androidHome,
    [pathKey]: extraPath.join(sep) + sep + (process.env[pathKey] || ''),
  };
}
