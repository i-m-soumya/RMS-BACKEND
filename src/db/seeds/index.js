import db from '../connection.js';
import bcrypt from 'bcrypt';
import { v4 as uuidv4 } from 'uuid';

async function seed() {
  try {
    console.log('Seeding data...');

    // Clean up in FK-safe order
    await db('bill_line_item_addons').del();
    await db('bill_line_items').del();
    await db('bill_orders').del();
    await db('ratings').del();
    await db('bills').del();
    await db('staff_activity_log').del();
    await db('order_item_addons').del();
    await db('order_items').del();
    await db('orders').del();
    await db('menu_item_availability_log').del();
    await db('menu_item_images').del();
    await db('menu_item_schedules').del();
    await db('menu_item_pairings').del();
    await db('session_members').del();
    await db('customer_guest_tokens').del();
    await db('sessions').del();
    await db('invoice_sequences').del();
    await db('restaurant_tax_config').del();
    await db('staff_sessions').del();
    await db('tables').del();
    await db('floors').del();
    await db('restaurant_holidays').del();
    await db('operating_hours').del();
    await db('menu_item_addon_map').del();
    await db('menu_item_categories').del();
    await db('menu_items').del();
    await db('menu_categories').del();
    const existingPlatformAdmin = await db('platform_admins').select('id').first();
    if (existingPlatformAdmin) {
      await db('staff').update({ created_by_staff_id: null, created_by_platform_admin_id: existingPlatformAdmin.id });
    }
    await db('staff').del();
    await db('customers').del();
    await db('restaurants').del();
    await db('platform_admins').del();

    const platformPasswordHash = await bcrypt.hash('Admin123!', 10);
    const adminPasswordHash = await bcrypt.hash('Admin123!', 10);
    const waiterPasswordHash = await bcrypt.hash('Waiter123!', 10);
    const chefPasswordHash = await bcrypt.hash('Chef123!', 10);

    const adminId = uuidv4();
    await db('platform_admins').insert({
      id: adminId,
      name: 'Platform Admin',
      email: 'platform@example.com',
      password_hash: platformPasswordHash,
      is_active: 1
    });

    const restaurantId = uuidv4();
    await db('restaurants').insert({
      id: restaurantId,
      name: 'Burger Co',
      legal_name: 'Burger Co Foods Pvt Ltd',
      slug: 'burger-co',
      contact_email: 'hello@burger-co.local',
      address: '123 MG Road, Mumbai',
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
        email: 'admin@burger-co.local',
        password_hash: adminPasswordHash,
        role: 'restaurant_admin',
        access: 'active',
        created_by_platform_admin_id: adminId
      },
      {
        id: staffId2,
        restaurant_id: restaurantId,
        name: 'Waiter',
        email: 'waiter@burger-co.local',
        password_hash: waiterPasswordHash,
        role: 'waiter',
        access: 'active',
        created_by_platform_admin_id: adminId
      },
      {
        id: staffId3,
        restaurant_id: restaurantId,
        name: 'Chef',
        email: 'chef@burger-co.local',
        password_hash: chefPasswordHash,
        role: 'chef',
        access: 'active',
        created_by_platform_admin_id: adminId
      }
    ]);

    const customerId = uuidv4();
    await db('customers').insert({
      id: customerId,
      name: 'Test Customer',
      email: 'customer@example.com',
      password_hash: await bcrypt.hash('password123', 10),
      is_registered: 1
    });

    const floors = [
      { id: uuidv4(), name: 'Main Dining', display_order: 1 },
      { id: uuidv4(), name: 'Patio', display_order: 2 },
      { id: uuidv4(), name: 'Private Dining', display_order: 3 },
    ];
    await db('floors').insert(floors.map((floor) => ({
      ...floor,
      restaurant_id: restaurantId,
      is_active: 1,
    })));

    const tableDefinitions = [
      ...['1', '2', '3', '4', '5', '6'].map((tableNumber) => ({ tableNumber, floorId: floors[0].id, seatingCapacity: 4 })),
      ...['7', '8', '9', '10'].map((tableNumber) => ({ tableNumber, floorId: floors[1].id, seatingCapacity: 2 })),
      ...['11', '12'].map((tableNumber) => ({ tableNumber, floorId: floors[2].id, seatingCapacity: 6 })),
    ];
    await db('tables').insert(tableDefinitions.map(({ tableNumber, floorId, seatingCapacity }) => ({
      id: uuidv4(),
      restaurant_id: restaurantId,
      floor_id: floorId,
      table_number: tableNumber,
      capacity: seatingCapacity,
      seating_capacity: seatingCapacity,
      status: 'available',
      is_active: 1,
    })));

    const catBurgersId = uuidv4();
    const catSidesId = uuidv4();
    const catDrinksId = uuidv4();
    await db('menu_categories').insert([
      {
        id: catBurgersId,
        restaurant_id: restaurantId,
        name: 'Burgers',
        display_order: 1,
        is_active: 1
      },
      {
        id: catSidesId,
        restaurant_id: restaurantId,
        name: 'Sides',
        display_order: 2,
        is_active: 1
      },
      {
        id: catDrinksId,
        restaurant_id: restaurantId,
        name: 'Drinks',
        display_order: 3,
        is_active: 1
      }
    ]);

    const classicBurgerId = uuidv4();
    const crispyChickenBurgerId = uuidv4();
    const veggieStackId = uuidv4();
    const loadedFriesId = uuidv4();
    const onionRingsId = uuidv4();
    const chocolateShakeId = uuidv4();
    const addonCheeseId = uuidv4();
    const addonBaconId = uuidv4();
    const addonJalapenosId = uuidv4();
    await db('menu_items').insert([
      {
        id: classicBurgerId,
        restaurant_id: restaurantId,
        name: 'Classic Smash Burger',
        description: 'Two smashed beef patties, American cheese, pickles, onions, and house sauce on a toasted brioche bun.',
        mrp: 349.00,
        price: 299.00,
        item_type: 'regular',
        dietary_type: 'non_veg',
        spice_level: 'medium',
        is_available: 1
      },
      {
        id: crispyChickenBurgerId,
        restaurant_id: restaurantId,
        name: 'Crispy Chicken Burger',
        description: 'Crispy fried chicken, lettuce, crunchy slaw, and chipotle mayo in a toasted brioche bun.',
        mrp: 379.00,
        price: 329.00,
        item_type: 'regular',
        dietary_type: 'non_veg',
        spice_level: 'hot',
        is_available: 1
      },
      {
        id: veggieStackId,
        restaurant_id: restaurantId,
        name: 'Veggie Stack Burger',
        description: 'Crispy vegetable patty, cheddar, lettuce, tomato, and roasted garlic mayo on a sesame bun.',
        mrp: 299.00,
        price: 249.00,
        item_type: 'regular',
        dietary_type: 'veg',
        spice_level: 'mild',
        is_available: 1
      },
      {
        id: loadedFriesId,
        restaurant_id: restaurantId,
        name: 'Loaded Cheese Fries',
        description: 'Crispy seasoned fries covered with warm cheese sauce and spring onions.',
        mrp: 199.00,
        price: 169.00,
        item_type: 'regular',
        dietary_type: 'veg',
        is_available: 1
      },
      {
        id: onionRingsId,
        restaurant_id: restaurantId,
        name: 'Beer-Battered Onion Rings',
        description: 'Golden onion rings served with our smoky barbecue dip.',
        mrp: 179.00,
        price: 149.00,
        item_type: 'regular',
        dietary_type: 'veg',
        is_available: 1
      },
      {
        id: chocolateShakeId,
        restaurant_id: restaurantId,
        name: 'Chocolate Thick Shake',
        description: 'Creamy chocolate shake blended with vanilla ice cream and finished with chocolate drizzle.',
        mrp: 229.00,
        price: 199.00,
        item_type: 'regular',
        dietary_type: 'veg',
        is_available: 1
      },
      {
        id: addonCheeseId,
        restaurant_id: restaurantId,
        name: 'Extra Cheese Slice',
        description: 'A melted American cheese slice added to your burger.',
        mrp: 40.00,
        price: 40.00,
        item_type: 'addon_only',
        dietary_type: 'veg',
        is_available: 1
      },
      {
        id: addonBaconId,
        restaurant_id: restaurantId,
        name: 'Crispy Bacon',
        description: 'Smoky, crispy bacon strips for an extra savoury bite.',
        mrp: 70.00,
        price: 60.00,
        item_type: 'addon_only',
        dietary_type: 'non_veg',
        is_available: 1
      },
      {
        id: addonJalapenosId,
        restaurant_id: restaurantId,
        name: 'Jalapenos',
        description: 'Sliced pickled jalapenos for extra heat.',
        mrp: 30.00,
        price: 25.00,
        item_type: 'addon_only',
        dietary_type: 'veg',
        is_available: 1
      }
    ]);

    const categoryMappings = [
      [classicBurgerId, catBurgersId, 1],
      [crispyChickenBurgerId, catBurgersId, 2],
      [veggieStackId, catBurgersId, 3],
      [loadedFriesId, catSidesId, 1],
      [onionRingsId, catSidesId, 2],
      [chocolateShakeId, catDrinksId, 1],
    ];
    await db('menu_item_categories').insert([
      ...categoryMappings.map(([menuItemId, categoryId, displayOrder]) => ({
        id: uuidv4(),
        menu_item_id: menuItemId,
        category_id: categoryId,
        restaurant_id: restaurantId,
        display_order: displayOrder,
        is_primary_category: 1,
        is_active: 1
      }))
    ]);

    await db('menu_item_addon_map').insert([
      ...[
        [classicBurgerId, addonCheeseId],
        [classicBurgerId, addonBaconId],
        [classicBurgerId, addonJalapenosId],
        [crispyChickenBurgerId, addonCheeseId],
        [crispyChickenBurgerId, addonBaconId],
        [crispyChickenBurgerId, addonJalapenosId],
        [veggieStackId, addonCheeseId],
        [veggieStackId, addonJalapenosId],
        [loadedFriesId, addonCheeseId],
      ].map(([menuItemId, addonId]) => ({
        id: uuidv4(),
        menu_item_id: menuItemId,
        addon_id: addonId,
        restaurant_id: restaurantId,
      }))
    ]);

    console.log('Seeding completed successfully!');
    process.exit(0);
  } catch (error) {
    console.error('Seeding failed:', error);
    process.exit(1);
  }
}

seed();
