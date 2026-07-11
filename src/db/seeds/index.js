import db from '../connection.js';
import bcrypt from 'bcrypt';
import { v4 as uuidv4 } from 'uuid';

async function seed() {
  try {
    console.log('Seeding data...');

    // Clean up
    await db('bill_line_items').del();
    await db('bills').del();
    await db('order_items').del();
    await db('orders').del();
    await db('session_members').del();
    await db('sessions').del();
    await db('tables').del();
    await db('floors').del();
    await db('menu_item_categories').del();
    await db('menu_items').del();
    await db('menu_categories').del();
    await db('staff').del();
    await db('restaurants').del();
    await db('platform_admins').del();

    const adminId = uuidv4();
    await db('platform_admins').insert({
      id: adminId,
      name: 'Super Admin',
      email: 'admin@rms.com',
      password_hash: await bcrypt.hash('password123', 10),
      role: 'super',
      is_active: 1
    });

    const restaurantId = uuidv4();
    await db('restaurants').insert({
      id: restaurantId,
      name: 'Spice Garden',
      slug: 'spice-garden',
      address: '123 MG Road',
      city: 'Mumbai',
      state: 'Maharashtra',
      pincode: '400001',
      timezone: 'Asia/Kolkata',
      currency: 'INR',
      onboarded_by: adminId,
      status: 'active'
    });

    const staffId1 = uuidv4();
    const staffId2 = uuidv4();
    const staffId3 = uuidv4();
    await db('staff').insert([
      {
        id: staffId1,
        restaurant_id: restaurantId,
        name: 'Restaurant Admin',
        email: 'manager@spicegarden.com',
        password_hash: await bcrypt.hash('password123', 10),
        role: 'restaurant_admin',
        access: 'active',
        created_by_platform_admin_id: adminId
      },
      {
        id: staffId2,
        restaurant_id: restaurantId,
        name: 'Waiter John',
        email: 'waiter@spicegarden.com',
        password_hash: await bcrypt.hash('password123', 10),
        role: 'waiter',
        access: 'active',
        created_by_platform_admin_id: adminId
      },
      {
        id: staffId3,
        restaurant_id: restaurantId,
        name: 'Chef Maria',
        email: 'chef@spicegarden.com',
        password_hash: await bcrypt.hash('password123', 10),
        role: 'chef',
        access: 'active',
        created_by_platform_admin_id: adminId
      }
    ]);

    const floorId = uuidv4();
    await db('floors').insert({
      id: floorId,
      restaurant_id: restaurantId,
      name: 'Main Dining',
      display_order: 1,
      is_active: 1
    });

    const tableId = uuidv4();
    await db('tables').insert({
      id: tableId,
      restaurant_id: restaurantId,
      floor_id: floorId,
      table_number: '1',
      seating_capacity: 4,
      status: 'available',
      is_active: 1
    });

    const catStartersId = uuidv4();
    const catMainsId = uuidv4();
    await db('menu_categories').insert([
      {
        id: catStartersId,
        restaurant_id: restaurantId,
        name: 'Starters',
        display_order: 1,
        is_active: 1
      },
      {
        id: catMainsId,
        restaurant_id: restaurantId,
        name: 'Main Course',
        display_order: 2,
        is_active: 1
      }
    ]);

    const item1Id = uuidv4();
    const item2Id = uuidv4();
    await db('menu_items').insert([
      {
        id: item1Id,
        restaurant_id: restaurantId,
        name: 'Paneer Tikka',
        description: 'Cottage cheese marinated in spices and grilled',
        mrp: 250.00,
        price: 250.00,
        item_type: 'regular',
        dietary_type: 'veg',
        is_available: 1
      },
      {
        id: item2Id,
        restaurant_id: restaurantId,
        name: 'Butter Chicken',
        description: 'Classic rich tomato gravy with chicken',
        mrp: 450.00,
        price: 450.00,
        item_type: 'regular',
        dietary_type: 'non_veg',
        is_available: 1
      }
    ]);

    const map1Id = uuidv4();
    const map2Id = uuidv4();
    await db('menu_item_categories').insert([
      {
        id: map1Id,
        menu_item_id: item1Id,
        category_id: catStartersId,
        restaurant_id: restaurantId,
        display_order: 1,
        is_primary_category: 1,
        is_active: 1
      },
      {
        id: map2Id,
        menu_item_id: item2Id,
        category_id: catMainsId,
        restaurant_id: restaurantId,
        display_order: 1,
        is_primary_category: 1,
        is_active: 1
      }
    ]);

    console.log('Seeding completed successfully!');
    process.exit(0);
  } catch (error) {
    console.error('Seeding failed:', error);
    process.exit(1);
  }
}

seed();
