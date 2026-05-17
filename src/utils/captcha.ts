
import { Env } from '../types/env';

const CAPTCHA_EXPIRE_TIME = 5 * 60 * 1000; // 5分钟
const CAPTCHA_PREFIX = 'captcha:';

/**
 * 生成验证码 SVG
 */
export function generateCaptchaSvg(): { text: string; svg: string } {
  const chars = '0123456789';
  let text = '';
  for (let i = 0; i < 4; i++) {
    text += chars[Math.floor(Math.random() * chars.length)];
  }

  const width = 120;
  const height = 40;
  
  const svg = `
    <svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
      <rect width="100%" height="100%" fill="#f0f0f0"/>
      <text x="10" y="30" font-size="30" fill="#333" font-family="Arial, sans-serif">
        ${text.split('').map((char, i) => `
          <tspan x="${10 + i * 28}" y="${30 + Math.random() * 10 - 5}" rotate="${Math.random() * 20 - 10}">
            ${char}
          </tspan>
        `).join('')}
      </text>
      ${Array.from({ length: 10 }).map(() => `
        <line x1="${Math.random() * width}" y1="${Math.random() * height}"
              x2="${Math.random() * width}" y2="${Math.random() * height}"
              stroke="#999" stroke-width="1"/>
      `).join('')}
      ${Array.from({ length: 50 }).map(() => `
        <circle cx="${Math.random() * width}" cy="${Math.random() * height}" r="1" fill="#666"/>
      `).join('')}
    </svg>
  `.trim();

  return { text, svg };
}

/**
 * 生成验证码
 */
export async function generateCaptcha(env: Env): Promise<{ captchaId: string; svg: string }> {
  const { text, svg } = generateCaptchaSvg();
  const captchaId = `captcha_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  
  await env.CACHE.put(`${CAPTCHA_PREFIX}${captchaId}`, JSON.stringify({
    text,
    createTime: Date.now()
  }), {
    expirationTtl: CAPTCHA_EXPIRE_TIME / 1000
  });

  return { captchaId, svg };
}

/**
 * 验证验证码
 */
export async function verifyCaptcha(captchaId: string, userInput: string, env: Env): Promise<boolean> {
  if (!captchaId || !userInput) {
    return false;
  }
  const key = `${CAPTCHA_PREFIX}${captchaId}`;
  const value = await env.CACHE.get(key);
  
  if (!value) {
    return false;
  }

  const data = JSON.parse(value);

  if (Date.now() - data.createTime > CAPTCHA_EXPIRE_TIME) {
    await env.CACHE.delete(key);
    return false;
  }

  const isValid = data.text === userInput;
  
  if (isValid) {
    await env.CACHE.delete(key);
  }

  return isValid;
}

