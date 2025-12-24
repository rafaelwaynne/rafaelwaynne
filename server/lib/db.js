const { db } = require('./firebase');

// Helper to convert snapshot to array
async function colToArray(colName) {
  try {
    const snapshot = await db.collection(colName).get();
    if (snapshot.empty) return [];
    return snapshot.docs.map(doc => {
      const data = doc.data();
      // Ensure ID is part of the object if it wasn't stored in the data
      return { id: doc.id, ...data };
    });
  } catch (err) {
    console.error(`Error fetching ${colName}:`, err);
    return [];
  }
}

const DB = {
  // Users
  getUsers: () => colToArray('users'),
  getUserByEmail: async (email) => {
    try {
      const snap = await db.collection('users').where('email', '==', email).limit(1).get();
      if (snap.empty) return null;
      const doc = snap.docs[0];
      return { id: doc.id, ...doc.data() };
    } catch (err) {
      console.error('Error fetching user:', err);
      return null;
    }
  },

  // Generic Lists
  getStores: () => colToArray('stores'),
  getCameras: () => colToArray('cameras'),
  getVehicles: () => colToArray('vehicles'),
  
  // Layout (stored as a single document 'settings/layout')
  getLayout: async () => {
    try {
      const doc = await db.collection('settings').doc('layout').get();
      return doc.exists ? (doc.data().items || []) : [];
    } catch (err) {
      console.error('Error fetching layout:', err);
      return [];
    }
  },
  saveLayout: async (items) => {
    try {
      await db.collection('settings').doc('layout').set({ items });
      return true;
    } catch (err) {
      console.error('Error saving layout:', err);
      throw err;
    }
  },

  // Invoices
  getInvoices: async () => {
    // Fetch all and let controller filter (matching previous behavior)
    return colToArray('invoices');
  },
  addInvoice: async (inv) => {
    try {
      await db.collection('invoices').doc(inv.id).set(inv);
      return inv;
    } catch (err) {
      console.error('Error adding invoice:', err);
      throw err;
    }
  },

  // Processes
  getProcesses: () => colToArray('processes'),
  getProcess: async (id) => {
    try {
      const doc = await db.collection('processes').doc(id).get();
      return doc.exists ? { id: doc.id, ...doc.data() } : null;
    } catch (err) {
      return null;
    }
  },
  saveProcess: async (proc) => {
    try {
      await db.collection('processes').doc(proc.id).set(proc);
      return proc;
    } catch (err) {
      console.error('Error saving process:', err);
      throw err;
    }
  },
  // Used for updates
  updateProcess: async (id, data) => {
    try {
      await db.collection('processes').doc(id).update(data);
      return true;
    } catch (err) {
      console.error('Error updating process:', err);
      throw err;
    }
  },

  // Events
  getEvents: () => colToArray('events'),
  addEvent: async (ev) => {
    try {
      await db.collection('events').doc(ev.id).set(ev);
      return ev;
    } catch (err) {
      console.error('Error adding event:', err);
      throw err;
    }
  },
  deleteEvent: async (id) => {
    try {
      await db.collection('events').doc(id).delete();
      return true;
    } catch (err) {
      console.error('Error deleting event:', err);
      throw err;
    }
  },

  // Audit Logs (process-scan-logs)
  // Originally stored in process-scan-logs.json
  appendScanLog: async (rec) => {
    try {
      await db.collection('process_scan_logs').add({
        ...rec,
        createdAt: new Date().toISOString()
      });
    } catch (err) {
      console.error('Error appending scan log:', err);
    }
  },

  // Seeding
  seed: async (data) => {
    try {
      // Check if users exist as a proxy for "is seeded"
      const usersSnap = await db.collection('users').limit(1).get();
      if (!usersSnap.empty) return; // Already seeded

      console.log('Seeding database...');
      const batch = db.batch();

      // Users
      if (data.users) {
        data.users.forEach(u => {
          const ref = db.collection('users').doc(u.id);
          batch.set(ref, u);
        });
      }
      // Stores
      if (data.stores) {
        data.stores.forEach(s => {
          const ref = db.collection('stores').doc(s.id);
          batch.set(ref, s);
        });
      }
      // Cameras
      if (data.cameras) {
        data.cameras.forEach(c => {
          const ref = db.collection('cameras').doc(c.id);
          batch.set(ref, c);
        });
      }
      // Vehicles
      if (data.vehicles) {
        data.vehicles.forEach(v => {
          const ref = db.collection('vehicles').doc(v.id);
          batch.set(ref, v);
        });
      }
      // Layout
      if (data.layout) {
        const ref = db.collection('settings').doc('layout');
        batch.set(ref, { items: data.layout });
      }

      // Commit
      await batch.commit();
      console.log('Database seeded successfully.');
    } catch (err) {
      console.error('Error seeding database:', err);
    }
  }
};

module.exports = DB;
