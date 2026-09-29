'use strict';
const APP_URL = 'chillpass://app/';
function isAppUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'chillpass:' && url.hostname === 'app' && !url.port && !url.username && !url.password;
  } catch { return false; }
}
function externalUrl(value) {
  if (typeof value !== 'string' || value.length > 8192) return null;
  try {
    const url = new URL(value);
    return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password ? url.href : null;
  } catch { return null; }
}
const API_METHODS = {
  '/api/learningData': ['GET', 'POST'],
  '/api/getAppVersion': ['GET'],
  '/api/getCourseStorageRoot': ['GET'],
  '/api/setCourseStorageRoot': ['POST'],
  '/api/selectDirectory': ['POST'],
  '/api/ensureCourseDir': ['POST'],
  '/api/listCourseFiles': ['GET'],
  '/api/storeCourseFile': ['POST'],
  '/api/openCourseDir': ['POST'],
  '/api/readFile': ['GET'],
  '/api/fileExists': ['GET'],
  '/api/getFileSize': ['GET'],
  '/api/getAppPaths': ['GET'],
  '/api/openInstallPath': ['POST'],
  '/api/fetchProviderModels': ['POST'],
};
function allowedRequest(url, method) {
  if (!isAppUrl(url)) return false;
  const pathname = new URL(url).pathname;
  if (pathname.startsWith('/api/')) return API_METHODS[pathname]?.includes(method) === true;
  return ['GET', 'HEAD'].includes(method) && (
    ['/', '/index.html', '/icon.ico', '/qrcode.jpg'].includes(pathname) || /^\/assets\/[a-zA-Z0-9_.-]+$/.test(pathname)
  );
}
module.exports = { APP_URL, isAppUrl, externalUrl, allowedRequest };
