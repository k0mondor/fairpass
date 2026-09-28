import type { Response } from "express";

export interface PageMeta {
  page: number;
  pageSize: number;
  total: number;
}

export const sendData = <T>(
  response: Response,
  data: T,
  status = 200,
): Response => response.status(status).json({ data });

export const sendPage = <T>(
  response: Response,
  data: readonly T[],
  meta: PageMeta,
): Response =>
  response.json({
    data,
    page: meta.page,
    pageSize: meta.pageSize,
    total: meta.total,
  });
