# Session-only Android toolchain for this project (Git Bash on Windows, or bash/zsh on macOS/Linux).
# Changes NOTHING globally.
#
#   cd native && source scripts/env.sh
#
# Afterwards in this shell only:
#   java / keytool -> JDK 21            adb / sdkmanager / avdmanager / emulator -> project SDK
#   mg_gradlew assembleRelease          # gradlew in native/android with JDK pin + proxy flags
#   mg_sdkmanager --list_installed      # sdkmanager with --sdk_root + proxy flags
#
# Overrides (export before sourcing): MINIGAMES_JAVA_HOME, MINIGAMES_ANDROID_HOME,
# MINIGAMES_PROXY (e.g. http://127.0.0.1:2080, or "none"; default: the proxy on Windows, none elsewhere).

_mg_src="${BASH_SOURCE[0]:-$0}"
MINIGAMES_NATIVE_DIR="$(cd "$(dirname "$_mg_src")/.." && pwd)"
export MINIGAMES_NATIVE_DIR

case "$(uname -s)" in
  MINGW*|MSYS*|CYGWIN*) _mg_win=1 ;;
  *) _mg_win=0 ;;
esac

_mg_home="${USERPROFILE:-$HOME}"
[ "$_mg_win" = 1 ] && _mg_home="$(cygpath -u "$_mg_home")"
_mg_jdk="${MINIGAMES_JAVA_HOME:-$_mg_home/dev/jdk-21}"
_mg_sdk="${MINIGAMES_ANDROID_HOME:-$_mg_home/dev/android-sdk}"
if [ -n "${MINIGAMES_PROXY:-}" ]; then _mg_proxy="$MINIGAMES_PROXY"
elif [ "$_mg_win" = 1 ]; then _mg_proxy="http://127.0.0.1:2080"
else _mg_proxy="none"; fi

[ -x "$_mg_jdk/bin/java" ] || [ -x "$_mg_jdk/bin/java.exe" ] || echo "warning: JDK 21 not found at $_mg_jdk" >&2
[ -d "$_mg_sdk/platform-tools" ] || echo "warning: Android SDK not found at $_mg_sdk" >&2

# Windows-native tools (gradle, sdkmanager.bat) want Windows paths in these variables.
if [ "$_mg_win" = 1 ]; then
  export JAVA_HOME="$(cygpath -w "$_mg_jdk")" ANDROID_HOME="$(cygpath -w "$_mg_sdk")"
else
  export JAVA_HOME="$_mg_jdk" ANDROID_HOME="$_mg_sdk"
fi
export ANDROID_SDK_ROOT="$ANDROID_HOME"
# project emulator lives in ~/dev/android-avd, not ~/.android/avd
if [ -d "$_mg_home/dev/android-avd" ]; then
  if [ "$_mg_win" = 1 ]; then export ANDROID_AVD_HOME="$(cygpath -w "$_mg_home/dev/android-avd")"
  else export ANDROID_AVD_HOME="$_mg_home/dev/android-avd"; fi
fi

for _mg_p in "$_mg_sdk/emulator" "$_mg_sdk/cmdline-tools/latest/bin" "$_mg_sdk/platform-tools" "$_mg_jdk/bin"; do
  case ":$PATH:" in *":$_mg_p:"*) ;; *) PATH="$_mg_p:$PATH" ;; esac
done
export PATH

MINIGAMES_GRADLE_ARGS="-Dorg.gradle.java.home=$JAVA_HOME"
MINIGAMES_SDK_PROXY_ARGS=""
if [ "$_mg_proxy" != "none" ]; then
  _mg_hp="${_mg_proxy#*://}"; _mg_hp="${_mg_hp%%/*}"
  _mg_host="${_mg_hp%%:*}"; _mg_port="${_mg_hp##*:}"; [ "$_mg_port" = "$_mg_hp" ] && _mg_port=80
  MINIGAMES_GRADLE_ARGS="$MINIGAMES_GRADLE_ARGS -Dhttp.proxyHost=$_mg_host -Dhttp.proxyPort=$_mg_port -Dhttps.proxyHost=$_mg_host -Dhttps.proxyPort=$_mg_port"
  MINIGAMES_SDK_PROXY_ARGS="--proxy=http --proxy_host=$_mg_host --proxy_port=$_mg_port"
fi
export MINIGAMES_GRADLE_ARGS MINIGAMES_SDK_PROXY_ARGS

mg_gradlew() {
  # word-splitting of the flag string is intended (no spaces inside individual flags)
  # shellcheck disable=SC2086
  (cd "$MINIGAMES_NATIVE_DIR/android" && ./gradlew $MINIGAMES_GRADLE_ARGS "$@")
}

mg_sdkmanager() {
  local bin="$_mg_sdk/cmdline-tools/latest/bin/sdkmanager"
  [ "$_mg_win" = 1 ] && bin="$bin.bat"
  # shellcheck disable=SC2086
  "$bin" --sdk_root="$ANDROID_HOME" $MINIGAMES_SDK_PROXY_ARGS "$@"
}

echo "JAVA_HOME=$JAVA_HOME"
echo "ANDROID_HOME=$ANDROID_HOME"
echo "Gradle flags: $MINIGAMES_GRADLE_ARGS"
echo "Helpers: mg_gradlew <tasks>, mg_sdkmanager <args>   (npm run apk does everything)"
