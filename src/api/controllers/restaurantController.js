import db from '../../db/connection.js';

export const getRestaurant = async (req, res, next) => {
  try {
    const { slug } = req.params;
    
    let [restaurant] = await db('restaurants').where({ slug }).limit(1);
    if (!restaurant) {
      [restaurant] = await db('restaurants').where({ id: slug }).limit(1);
    }
    
    if (!restaurant) {
      return res.status(404).json({ error: 'Restaurant not found' });
    }

    // Filter sensitive info
    const safeRestaurant = {
      id: restaurant.id,
      name: restaurant.name,
      slug: restaurant.slug,
      logo_url: restaurant.logo_url,
      welcome_message: restaurant.welcome_message,
      status: restaurant.status
    };

    res.json(safeRestaurant);
  } catch (error) {
    next(error);
  }
};

export const getRestaurantMenu = async (req, res, next) => {
  try {
    const { slug } = req.params;
    
    let [restaurant] = await db('restaurants').where({ slug }).limit(1);
    if (!restaurant) {
      [restaurant] = await db('restaurants').where({ id: slug }).limit(1);
    }
    
    if (!restaurant) {
      return res.status(404).json({ error: 'Restaurant not found' });
    }

    const categories = await db('menu_categories')
      .where({ restaurant_id: restaurant.id })
      .orderBy('display_order', 'asc');

    const items = await db('menu_items')
      .where({ restaurant_id: restaurant.id });

    const map = await db('menu_item_categories').where({ restaurant_id: restaurant.id });

    // Format for frontend: grouped by category
    const menu = categories.map(cat => {
      const catItemIds = map.filter(m => m.category_id === cat.id).map(m => m.menu_item_id);
      return {
        ...cat,
        items: items.filter(item => catItemIds.includes(item.id))
      };
    });

    res.json(menu);
  } catch (error) {
    next(error);
  }
};

export const getTable = async (req, res, next) => {
  try {
    const { id, tableId } = req.params;
    
    let [table] = await db('tables').where({ id: tableId, restaurant_id: id }).limit(1);

    if (!table) {
      [table] = await db('tables')
        .where({ table_number: tableId, restaurant_id: id })
        .limit(1);
    }
    
    if (!table) {
      return res.status(404).json({ error: 'Table not found' });
    }
    
    res.json(table);
  } catch (error) {
    next(error);
  }
};
