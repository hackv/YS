/**
 * 转换工具：将对象的键名从 camelCase 转换为 snake_case
 * 解决 Drizzle ORM 返回 camelCase，但前端期望 snake_case 的问题
 */

export function toSnakeCase(obj: unknown): unknown {
  if (obj === null || obj === undefined) {
    return obj;
  }

  if (Array.isArray(obj)) {
    return obj.map(item => toSnakeCase(item));
  }

  if (typeof obj === 'object') {
    return Object.keys(obj as object).reduce((result, key) => {
      const snakeKey = key.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`);
      (result as Record<string, unknown>)[snakeKey] = toSnakeCase((obj as Record<string, unknown>)[key]);
      return result;
    }, {} as Record<string, unknown>);
  }

  return obj;
}