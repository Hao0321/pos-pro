-- POS Pro Supabase Schema v2.3.0
-- 在 Supabase Dashboard → SQL Editor 整個貼上後執行
-- 欄位用 camelCase（與前端 JS 物件直接對應，不用 transform）

-- ===== 商品 =====
create table if not exists products (
  "id" text primary key,
  "name" text not null,
  "category" text default '',
  "price" numeric default 0,
  "cost" numeric default 0,
  "stock" integer default 0,
  "barcode" text default '',
  "unit" text default '個',
  "noBarcode" boolean default false,
  "imageUrl" text default '',
  "expiryDate" text default '',
  "supplierId" text default '',
  "reorderLevel" integer default 0,
  "updatedAt" timestamptz default now()
);
create index if not exists idx_products_supplier on products("supplierId");

-- ===== 會員 =====
create table if not exists members (
  "id" text primary key,
  "name" text not null,
  "phone" text default '',
  "points" integer default 0,
  "tier" text default 'normal',
  "totalSpent" numeric default 0,
  "joinDate" text default '',
  "balance" numeric default 0,
  "birthday" text default '',
  "lastBirthdayBonus" text default ''
);

-- ===== 訂單 =====
create table if not exists orders (
  "id" text primary key,
  "items" jsonb default '[]',
  "subtotal" numeric default 0,
  "discount" numeric default 0,
  "manualDiscount" numeric default 0,
  "balanceUsed" numeric default 0,
  "total" numeric default 0,
  "payMethod" text default 'cash',
  "paid" numeric default 0,
  "change" numeric default 0,
  "payments" jsonb default '[]',
  "memberId" text,
  "pointsUsed" integer default 0,
  "pointsEarned" integer default 0,
  "time" text not null,
  "source" text default 'pos',
  "status" text default 'completed',
  "tableNum" text default '',
  "note" text default '',
  "taxId" text default '',
  "shiftId" text default '',
  "refundOf" text default '',
  "cashier" text default '',
  "fullRefund" boolean default false
);
-- v2.5.0 既有資料庫請補這欄（新建可略過，create table 已含）：儲值折抵金額，會計才能完整入帳
alter table orders add column if not exists "balanceUsed" numeric default 0;
create index if not exists idx_orders_time on orders("time");

-- ===== 供應商 =====
create table if not exists suppliers (
  "id" text primary key,
  "name" text not null,
  "contact" text default '',
  "phone" text default '',
  "payTerms" text default '',
  "note" text default ''
);

-- ===== 進貨單 =====
create table if not exists purchases (
  "id" text primary key,
  "supplierId" text,
  "supplierName" text,
  "status" text default 'draft',
  "date" text,
  "receivedDate" text,
  "paidDate" text default '',
  "note" text default '',
  "total" numeric default 0,
  "items" jsonb default '[]'
);

-- ===== 促銷 =====
create table if not exists promotions (
  "id" text primary key,
  "name" text not null,
  "type" text not null,
  "condition" jsonb default '{}',
  "enabled" boolean default true,
  "startAt" text,
  "endAt" text
);

-- ===== 員工帳號 =====
create table if not exists users (
  "id" text primary key,
  "username" text unique not null,
  "password" text default '',
  "role" text default 'staff'
);

-- ===== 手動分錄（會計）=====
create table if not exists manual_journal (
  "id" text primary key,
  "orderId" text,
  "date" text not null,
  "description" text default '',
  "type" text default 'manual',
  "lines" jsonb default '[]'
);

-- ===== 掛單 =====
create table if not exists held_orders (
  "id" text primary key,
  "label" text default '',
  "cart" jsonb default '[]',
  "memberId" text default '',
  "manualDiscount" numeric default 0,
  "note" text default '',
  "createdAt" text not null,
  "cashier" text default ''
);

-- ===== 班別 =====
create table if not exists shifts (
  "id" text primary key,
  "cashier" text not null,
  "cashierId" text default '',
  "openTime" text not null,
  "closeTime" text default '',
  "openCash" numeric default 0,
  "closeCash" numeric default 0,
  "expectedCash" numeric default 0,
  "diff" numeric default 0,
  "cashSales" numeric default 0,
  "cardSales" numeric default 0,
  "orderCount" integer default 0,
  "refundCount" integer default 0,
  "refundAmount" numeric default 0,
  "note" text default '',
  "status" text default 'open'
);

-- ===== 現金流水 =====
create table if not exists cash_log (
  "id" text primary key,
  "shiftId" text default '',
  "time" text not null,
  "type" text not null,
  "amount" numeric not null,
  "reason" text default '',
  "cashier" text default ''
);

-- ===== 損耗 =====
create table if not exists waste_log (
  "id" text primary key,
  "productId" text not null,
  "productName" text default '',
  "qty" integer not null,
  "reason" text default '',
  "cost" numeric default 0,
  "time" text not null,
  "cashier" text default ''
);

-- ===== 會員儲值 =====
create table if not exists member_topups (
  "id" text primary key,
  "memberId" text not null,
  "amount" numeric not null,
  "bonus" numeric default 0,
  "payMethod" text default 'cash',
  "time" text not null,
  "cashier" text default '',
  "note" text default ''
);

-- ===== 稽核日誌 =====
create table if not exists audit_log (
  "id" text primary key,
  "timestamp" text not null,
  "action" text not null,
  "level" text default 'info',
  "label" text default '',
  "userId" text default '',
  "username" text default '',
  "role" text default '',
  "detail" jsonb default '{}'
);
create index if not exists idx_audit_timestamp on audit_log("timestamp");

-- ===== 關閉 RLS（單店家用模式）=====
-- ⚠️ 警告：關閉 RLS = 任何拿到 anon key 的人可讀寫所有資料（包含員工密碼 hash）
-- 適用單店家 / 自有裝置；多店家或不可信員工請改用 RLS policy
-- 如要加固 users 表（員工密碼），把這行改為 enable：
-- alter table users enable row level security;
alter table products disable row level security;
alter table members disable row level security;
alter table orders disable row level security;
alter table suppliers disable row level security;
alter table purchases disable row level security;
alter table promotions disable row level security;
alter table users disable row level security;
alter table manual_journal disable row level security;
alter table held_orders disable row level security;
alter table shifts disable row level security;
alter table cash_log disable row level security;
alter table waste_log disable row level security;
alter table member_topups disable row level security;
alter table audit_log disable row level security;
