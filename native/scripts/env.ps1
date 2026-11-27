# Session-only Android toolchain for this project (PowerShell). Changes NOTHING globally.
#
#   cd native ; . .\scripts\env.ps1        # note the leading ". " (dot-source)
#
# Afterwards in this PowerShell window only:
#   java / keytool  -> JDK 21            adb / sdkmanager / avdmanager / emulator -> project SDK
#   mg-gradlew assembleRelease           # gradlew in native\android with JDK pin + proxy flags
#   mg-sdkmanager --list_installed       # sdkmanager with --sdk_root + proxy flags
#
# Overrides (set before dot-sourcing): $env:MINIGAMES_JAVA_HOME, $env:MINIGAMES_ANDROID_HOME,
# $env:MINIGAMES_PROXY (e.g. http://127.0.0.1:2080, or "none").

$MinigamesNativeDir = Split-Path -Parent $PSScriptRoot

$jdk = if ($env:MINIGAMES_JAVA_HOME) { $env:MINIGAMES_JAVA_HOME } else { Join-Path $env:USERPROFILE 'dev\jdk-21' }
$sdk = if ($env:MINIGAMES_ANDROID_HOME) { $env:MINIGAMES_ANDROID_HOME } else { Join-Path $env:USERPROFILE 'dev\android-sdk' }
$proxy = if ($env:MINIGAMES_PROXY) { $env:MINIGAMES_PROXY } else { 'http://127.0.0.1:2080' }
if (-not (Test-Path (Join-Path $jdk 'bin\java.exe'))) { Write-Warning "JDK 21 not found at $jdk" }
if (-not (Test-Path (Join-Path $sdk 'platform-tools'))) { Write-Warning "Android SDK not found at $sdk" }

$env:JAVA_HOME = $jdk
$env:ANDROID_HOME = $sdk
$env:ANDROID_SDK_ROOT = $sdk
$avd = Join-Path $env:USERPROFILE 'dev\android-avd'
if (Test-Path $avd) { $env:ANDROID_AVD_HOME = $avd }   # project emulator lives here, not in ~/.android/avd

$prepend = @("$jdk\bin", "$sdk\platform-tools", "$sdk\cmdline-tools\latest\bin", "$sdk\emulator")
$rest = ($env:PATH -split ';') | Where-Object { $_ -and ($prepend -notcontains $_) }
$env:PATH = (($prepend + $rest) -join ';')

$global:MinigamesGradleArgs = @("-Dorg.gradle.java.home=$jdk")
$global:MinigamesSdkProxyArgs = @()
if ($proxy -and $proxy -ne 'none') {
    $u = [Uri]$proxy
    $global:MinigamesGradleArgs += @(
        "-Dhttp.proxyHost=$($u.Host)", "-Dhttp.proxyPort=$($u.Port)",
        "-Dhttps.proxyHost=$($u.Host)", "-Dhttps.proxyPort=$($u.Port)")
    $global:MinigamesSdkProxyArgs = @('--proxy=http', "--proxy_host=$($u.Host)", "--proxy_port=$($u.Port)")
}
$env:MINIGAMES_GRADLE_ARGS = $global:MinigamesGradleArgs -join ' '

function global:mg-gradlew {
    Push-Location (Join-Path $MinigamesNativeDir 'android')
    try { & .\gradlew.bat @global:MinigamesGradleArgs @args } finally { Pop-Location }
}

function global:mg-sdkmanager {
    & (Join-Path $env:ANDROID_HOME 'cmdline-tools\latest\bin\sdkmanager.bat') "--sdk_root=$env:ANDROID_HOME" @global:MinigamesSdkProxyArgs @args
}

Write-Host "JAVA_HOME=$env:JAVA_HOME"
Write-Host "ANDROID_HOME=$env:ANDROID_HOME"
Write-Host "Gradle flags: $env:MINIGAMES_GRADLE_ARGS"
Write-Host "Helpers: mg-gradlew <tasks>, mg-sdkmanager <args>   (npm run apk does everything)"
