/**
 * Centralized distribution and download configuration for Local Diary Core.
 *
 * Keeps versions and artifact URLs in sync across Windows, Android, and Web releases.
 */

export interface WindowsDownloadConfig {
  version: string;
  releaseDate: string;
  installerName: string;
  url: string;
  architecture: string;
  minOsVersion: string;
}

export interface AndroidDownloadConfig {
  version: string;
  versionCode: number;
  packageId: string;
  storeUrl: string;
  isStorePublished: boolean;
  apkUrl: string;
  apkFallbackUrl: string;
  apkName: string;
  minAndroidVersion: string;
}

export interface WebDownloadConfig {
  pwaInstalledSupported: boolean;
  workspaceUrl: string;
}

export interface DownloadsConfig {
  appVersion: string;
  repositoryUrl: string;
  releasesUrl: string;
  windows: WindowsDownloadConfig;
  android: AndroidDownloadConfig;
  web: WebDownloadConfig;
}

export const DOWNLOADS: DownloadsConfig = {
  appVersion: "1.1.0",
  repositoryUrl: "https://github.com/Ganeshkaithoju/local-diary-core",
  releasesUrl: "https://github.com/Ganeshkaithoju/local-diary-core/releases",
  windows: {
    version: "1.1.0",
    releaseDate: "2026-09-20",
    installerName: "Local Diary Core_1.1.0_x64-setup.exe",
    url: "https://github.com/Ganeshkaithoju/local-diary-core/releases/download/v1.1.0/Local%20Diary%20Core_1.1.0_x64-setup.exe",
    architecture: "x64 (64-bit Windows)",
    minOsVersion: "Windows 10 / 11 (64-bit)",
  },
  android: {
    version: "1.1.0",
    versionCode: 2,
    packageId: "com.mydiary.app",
    storeUrl: "https://play.google.com/store/apps/details?id=com.mydiary.app",
    isStorePublished: false, // Set to true once Google Play Console approves publication
    apkUrl: "/downloads/LocalDiaryCore_1.1.0.apk",
    apkFallbackUrl: "https://github.com/Ganeshkaithoju/local-diary-core/releases/download/v1.1.0/LocalDiaryCore_1.1.0.apk",
    apkName: "LocalDiaryCore_1.1.0.apk",
    minAndroidVersion: "Android 8.0 (Oreo, API 26)+",
  },
  web: {
    pwaInstalledSupported: true,
    workspaceUrl: "/dashboard",
  },
};
