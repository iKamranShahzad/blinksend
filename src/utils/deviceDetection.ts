export const detectDeviceType = (): string => {
  const ua = navigator.userAgent;
  const maxTouchPoints = navigator.maxTouchPoints || 0;

  if (/Android/i.test(ua)) {
    return /Mobile/i.test(ua) ? "Android Mobile" : "Android Tablet";
  }

  if (/iPhone/i.test(ua)) return "iPhone";
  if (/iPad/i.test(ua) || (maxTouchPoints > 1 && /Macintosh/i.test(ua)))
    return "iPad";
  if (/Mac/i.test(ua) && !/iPhone|iPad/i.test(ua)) return "Mac";

  if (/Windows NT/i.test(ua)) {
    return /Touch/i.test(ua) ? "Windows Tablet" : "Windows Desktop";
  }

  if (/Linux/i.test(ua) && !/Android/i.test(ua)) return "Linux Desktop";
  if (/CrOS/i.test(ua)) return "Chrome OS";

  return "Unknown Device";
};
