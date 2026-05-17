export interface ApiResponse<T = unknown> {
  code: number;
  msg: string;
  data?: T;
}

export const success = <T = unknown>(data?: T, msg: string = 'success'): ApiResponse<T> => ({
  code: 1,
  msg,
  data
});

export const error = (msg: string, code: number = 0): ApiResponse => ({
  code,
  msg,
  data: undefined
});

export const unauthorized = (msg: string = '未授权'): ApiResponse => ({
  code: 401,
  msg,
  data: undefined
});

export const forbidden = (msg: string = '禁止访问'): ApiResponse => ({
  code: 403,
  msg,
  data: undefined
});

export const notFound = (msg: string = '资源不存在'): ApiResponse => ({
  code: 404,
  msg,
  data: undefined
});

export const serverError = (msg: string = '服务器内部错误'): ApiResponse => ({
  code: 500,
  msg,
  data: undefined
});

export const badRequest = (msg: string = '请求参数错误'): ApiResponse => ({
  code: 400,
  msg,
  data: undefined
});
