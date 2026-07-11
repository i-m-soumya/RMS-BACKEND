-- RMS initial schema migration
-- Safety guarantees:
-- 1) Abort if any target table already exists.
-- 2) On failure, drop any tables created by this migration attempt.

DELIMITER //

DROP PROCEDURE IF EXISTS rms_apply_initial_schema //
CREATE PROCEDURE rms_apply_initial_schema()
BEGIN
  DECLARE existing_count INT DEFAULT 0;

  DECLARE EXIT HANDLER FOR SQLEXCEPTION
  BEGIN
    -- Best-effort cleanup to avoid partial schema after a failed run.
    DROP TABLE IF EXISTS ratings;
    DROP TABLE IF EXISTS bills;
    DROP TABLE IF EXISTS order_items;
    DROP TABLE IF EXISTS orders;
    DROP TABLE IF EXISTS menu_item_categories;
    DROP TABLE IF EXISTS menu_items;
    DROP TABLE IF EXISTS menu_categories;
    DROP TABLE IF EXISTS customer_guest_tokens;
    DROP TABLE IF EXISTS sessions;
    DROP TABLE IF EXISTS tables;
    DROP TABLE IF EXISTS floors;
    DROP TABLE IF EXISTS operating_hours;
    DROP TABLE IF EXISTS restaurant_holidays;
    DROP TABLE IF EXISTS staff;
    DROP TABLE IF EXISTS customers;
    DROP TABLE IF EXISTS restaurants;
    DROP TABLE IF EXISTS platform_admins;

    RESIGNAL;
  END;

  SELECT COUNT(*) INTO existing_count
  FROM information_schema.tables
  WHERE table_schema = DATABASE()
    AND table_name IN (
      'platform_admins',
      'restaurants',
      'customers',
      'staff',
      'operating_hours',
      'restaurant_holidays',
      'floors',
      'tables',
      'sessions',
      'customer_guest_tokens',
      'menu_categories',
      'menu_items',
      'menu_item_categories',
      'orders',
      'order_items',
      'bills',
      'ratings'
    );

  IF existing_count > 0 THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'Migration aborted: one or more RMS target tables already exist. Use a separate explicit migration plan.';
  END IF;

  CREATE TABLE platform_admins (
    id CHAR(36) NOT NULL DEFAULT (UUID()),
    name VARCHAR(100) NOT NULL,
    email VARCHAR(150) NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    is_active TINYINT(1) NOT NULL DEFAULT 1,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_platform_admins_email (email)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

  CREATE TABLE restaurants (
    id CHAR(36) NOT NULL DEFAULT (UUID()),
    name VARCHAR(150) NOT NULL,
    slug VARCHAR(100) NOT NULL,
    city VARCHAR(100) NOT NULL,
    country VARCHAR(100) NOT NULL,
    timezone VARCHAR(50) NOT NULL DEFAULT 'Asia/Kolkata',
    contact_email VARCHAR(150) NOT NULL,
    manager_name VARCHAR(150) NULL,
    logo_url VARCHAR(500) NULL,
    welcome_message TEXT NULL,
    gst_enabled TINYINT(1) NOT NULL DEFAULT 0,
    gst_number VARCHAR(50) NULL,
    status ENUM('active', 'suspended') NOT NULL DEFAULT 'active',
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_restaurants_slug (slug)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

  CREATE TABLE customers (
    id CHAR(36) NOT NULL DEFAULT (UUID()),
    email VARCHAR(150) NULL,
    phone VARCHAR(20) NULL,
    name VARCHAR(150) NULL,
    password_hash VARCHAR(255) NULL,
    is_registered TINYINT(1) NOT NULL DEFAULT 0,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_customers_email (email),
    UNIQUE KEY uq_customers_phone (phone)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

  CREATE TABLE staff (
    id CHAR(36) NOT NULL DEFAULT (UUID()),
    restaurant_id CHAR(36) NOT NULL,
    name VARCHAR(150) NOT NULL,
    email VARCHAR(150) NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    role ENUM('restaurant_admin', 'waiter', 'chef') NOT NULL,
    access ENUM('active', 'revoked') NOT NULL DEFAULT 'active',
    deleted_at DATETIME NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_staff_restaurant_email (restaurant_id, email),
    KEY idx_staff_restaurant_role (restaurant_id, role),
    CONSTRAINT fk_staff_restaurant FOREIGN KEY (restaurant_id) REFERENCES restaurants(id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

  CREATE TABLE operating_hours (
    id CHAR(36) NOT NULL DEFAULT (UUID()),
    restaurant_id CHAR(36) NOT NULL,
    day_of_week ENUM('Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday') NOT NULL,
    open_time TIME NULL,
    close_time TIME NULL,
    is_closed TINYINT(1) NOT NULL DEFAULT 0,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    KEY idx_operating_hours_restaurant_day (restaurant_id, day_of_week),
    CONSTRAINT fk_operating_hours_restaurant FOREIGN KEY (restaurant_id) REFERENCES restaurants(id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

  CREATE TABLE restaurant_holidays (
    id CHAR(36) NOT NULL DEFAULT (UUID()),
    restaurant_id CHAR(36) NOT NULL,
    holiday_date DATE NOT NULL,
    reason VARCHAR(255) NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_restaurant_holiday (restaurant_id, holiday_date),
    CONSTRAINT fk_restaurant_holidays_restaurant FOREIGN KEY (restaurant_id) REFERENCES restaurants(id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

  CREATE TABLE floors (
    id CHAR(36) NOT NULL DEFAULT (UUID()),
    restaurant_id CHAR(36) NOT NULL,
    name VARCHAR(100) NOT NULL,
    floor_order INT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    KEY idx_floors_restaurant (restaurant_id),
    CONSTRAINT fk_floors_restaurant FOREIGN KEY (restaurant_id) REFERENCES restaurants(id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

  CREATE TABLE tables (
    id CHAR(36) NOT NULL DEFAULT (UUID()),
    restaurant_id CHAR(36) NOT NULL,
    floor_id CHAR(36) NULL,
    name VARCHAR(100) NOT NULL,
    table_number VARCHAR(100) NOT NULL,
    capacity INT NOT NULL,
    status ENUM('available', 'active', 'bill_requested', 'inactive') NOT NULL DEFAULT 'available',
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_table_number_per_restaurant (restaurant_id, table_number),
    KEY idx_tables_restaurant_status (restaurant_id, status),
    CONSTRAINT fk_tables_restaurant FOREIGN KEY (restaurant_id) REFERENCES restaurants(id) ON DELETE CASCADE,
    CONSTRAINT fk_tables_floor FOREIGN KEY (floor_id) REFERENCES floors(id) ON DELETE SET NULL
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

  CREATE TABLE sessions (
    id CHAR(36) NOT NULL DEFAULT (UUID()),
    restaurant_id CHAR(36) NOT NULL,
    table_id CHAR(36) NOT NULL,
    status ENUM('active', 'bill_requested', 'closed') NOT NULL DEFAULT 'active',
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    KEY idx_sessions_table_status (table_id, status),
    KEY idx_sessions_restaurant_status (restaurant_id, status),
    CONSTRAINT fk_sessions_restaurant FOREIGN KEY (restaurant_id) REFERENCES restaurants(id) ON DELETE CASCADE,
    CONSTRAINT fk_sessions_table FOREIGN KEY (table_id) REFERENCES tables(id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

  CREATE TABLE customer_guest_tokens (
    id CHAR(36) NOT NULL,
    customer_id CHAR(36) NULL,
    token VARCHAR(255) NOT NULL,
    restaurant_id CHAR(36) NOT NULL,
    session_id CHAR(36) NULL,
    guest_token_created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    is_merged TINYINT(1) NOT NULL DEFAULT 0,
    merged_at DATETIME NULL,
    expires_at DATETIME NOT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_customer_guest_tokens_token (token),
    KEY idx_customer_guest_tokens_session (session_id),
    CONSTRAINT fk_customer_guest_tokens_customer FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE SET NULL,
    CONSTRAINT fk_customer_guest_tokens_restaurant FOREIGN KEY (restaurant_id) REFERENCES restaurants(id) ON DELETE CASCADE,
    CONSTRAINT fk_customer_guest_tokens_session FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

  CREATE TABLE menu_categories (
    id CHAR(36) NOT NULL DEFAULT (UUID()),
    restaurant_id CHAR(36) NOT NULL,
    name VARCHAR(255) NOT NULL,
    category_order INT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    KEY idx_menu_categories_restaurant (restaurant_id),
    CONSTRAINT fk_menu_categories_restaurant FOREIGN KEY (restaurant_id) REFERENCES restaurants(id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

  CREATE TABLE menu_items (
    id CHAR(36) NOT NULL DEFAULT (UUID()),
    restaurant_id CHAR(36) NOT NULL,
    category_id CHAR(36) NULL,
    name VARCHAR(255) NOT NULL,
    description TEXT NULL,
    price DECIMAL(10, 2) NOT NULL,
    image_url VARCHAR(500) NULL,
    is_available TINYINT(1) NOT NULL DEFAULT 1,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    KEY idx_menu_items_restaurant (restaurant_id),
    KEY idx_menu_items_category (category_id),
    CONSTRAINT fk_menu_items_restaurant FOREIGN KEY (restaurant_id) REFERENCES restaurants(id) ON DELETE CASCADE,
    CONSTRAINT fk_menu_items_category FOREIGN KEY (category_id) REFERENCES menu_categories(id) ON DELETE SET NULL
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

  CREATE TABLE menu_item_categories (
    id CHAR(36) NOT NULL DEFAULT (UUID()),
    menu_item_id CHAR(36) NOT NULL,
    category_id CHAR(36) NOT NULL,
    restaurant_id CHAR(36) NOT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_menu_item_categories (menu_item_id, category_id),
    KEY idx_menu_item_categories_restaurant (restaurant_id),
    CONSTRAINT fk_menu_item_categories_item FOREIGN KEY (menu_item_id) REFERENCES menu_items(id) ON DELETE CASCADE,
    CONSTRAINT fk_menu_item_categories_category FOREIGN KEY (category_id) REFERENCES menu_categories(id) ON DELETE CASCADE,
    CONSTRAINT fk_menu_item_categories_restaurant FOREIGN KEY (restaurant_id) REFERENCES restaurants(id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

  CREATE TABLE orders (
    id CHAR(36) NOT NULL DEFAULT (UUID()),
    session_id CHAR(36) NOT NULL,
    restaurant_id CHAR(36) NOT NULL,
    customer_id CHAR(36) NULL,
    idempotency_key VARCHAR(255) NULL,
    status ENUM('pending', 'confirmed', 'rejected') NOT NULL DEFAULT 'pending',
    total DECIMAL(10, 2) NOT NULL DEFAULT 0.00,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_orders_idempotency_key (idempotency_key),
    KEY idx_orders_session (session_id),
    CONSTRAINT fk_orders_session FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE,
    CONSTRAINT fk_orders_restaurant FOREIGN KEY (restaurant_id) REFERENCES restaurants(id) ON DELETE CASCADE,
    CONSTRAINT fk_orders_customer FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE SET NULL
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

  CREATE TABLE order_items (
    id CHAR(36) NOT NULL DEFAULT (UUID()),
    order_id CHAR(36) NOT NULL,
    menu_item_id CHAR(36) NOT NULL,
    quantity INT NOT NULL,
    status ENUM('pending', 'preparing', 'ready', 'served', 'rejected') NOT NULL DEFAULT 'pending',
    notes TEXT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    KEY idx_order_items_order (order_id),
    CONSTRAINT fk_order_items_order FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,
    CONSTRAINT fk_order_items_menu_item FOREIGN KEY (menu_item_id) REFERENCES menu_items(id) ON DELETE RESTRICT
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

  CREATE TABLE bills (
    id CHAR(36) NOT NULL DEFAULT (UUID()),
    session_id CHAR(36) NOT NULL,
    restaurant_id CHAR(36) NOT NULL,
    subtotal DECIMAL(10, 2) NOT NULL,
    gst_amount DECIMAL(10, 2) NOT NULL DEFAULT 0.00,
    total DECIMAL(10, 2) NOT NULL,
    status ENUM('generated', 'paid', 'cancelled') NOT NULL DEFAULT 'generated',
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    KEY idx_bills_session (session_id),
    CONSTRAINT fk_bills_session FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE,
    CONSTRAINT fk_bills_restaurant FOREIGN KEY (restaurant_id) REFERENCES restaurants(id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

  CREATE TABLE ratings (
    id CHAR(36) NOT NULL DEFAULT (UUID()),
    session_id CHAR(36) NOT NULL,
    customer_id CHAR(36) NULL,
    menu_item_id CHAR(36) NULL,
    overall_rating INT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    KEY idx_ratings_session (session_id),
    CONSTRAINT fk_ratings_session FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE,
    CONSTRAINT fk_ratings_customer FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE SET NULL,
    CONSTRAINT fk_ratings_menu_item FOREIGN KEY (menu_item_id) REFERENCES menu_items(id) ON DELETE SET NULL
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

END //

CALL rms_apply_initial_schema() //
DROP PROCEDURE IF EXISTS rms_apply_initial_schema //

DELIMITER ;
