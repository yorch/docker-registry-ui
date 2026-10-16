/*
 * Copyright (C) 2016-2023 Jones Magloire @Joxit
 *
 * Action names the tag table and its per-row remove-image control exchange.
 * They live here, not in tag-table.riot, so remove-image.riot does not have to
 * import the component that imports it.
 */

export const ACTION_CHECK_TO_DELETE = 'CHECK';
export const ACTION_UNCHECK_TO_DELETE = 'UNCHECK';
export const ACTION_DELETE_IMAGE = 'DELETE';
