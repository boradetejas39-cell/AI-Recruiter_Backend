const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const mongoose = require('mongoose');
const fs = require('fs');
const path = require('path');

const USERS_FILE = path.join(__dirname, '..', 'file-db', 'users.json');

/**
 * Unified data store that routes through MongoDB when connected,
 * otherwise falls back to file-db/users.json (persistent) + in-memory cache.
 */
class MemoryStore {
  constructor() {
    this.users = this._loadFromFile(); // load persisted users on startup
    console.log(`[MemoryStore] Loaded ${this.users.length} users from file-db`);
    this._hashPlaintextPasswords(); // ensure all passwords are bcrypt hashed
  }

  /** Load users array from file-db/users.json */
  _loadFromFile() {
    try {
      if (fs.existsSync(USERS_FILE)) {
        const raw = fs.readFileSync(USERS_FILE, 'utf8');
        return JSON.parse(raw);
      }
    } catch (err) {
      console.error('[MemoryStore] Failed to load users file:', err.message);
    }
    return [];
  }

  /** Hash any plaintext passwords found in loaded users (legacy data) */
  async _hashPlaintextPasswords() {
    let changed = false;
    for (const user of this.users) {
      // bcrypt hashes start with $2a$ or $2b$ — if not, it's plaintext
      if (user.password && !user.password.startsWith('$2')) {
        user.password = await bcrypt.hash(user.password, 12);
        changed = true;
      }
    }
    if (changed) {
      this._saveToFile();
      console.log('[MemoryStore] Hashed plaintext passwords and saved');
    }
  }

  /** Persist current users array to file-db/users.json */
  _saveToFile() {
    try {
      const dir = path.dirname(USERS_FILE);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(USERS_FILE, JSON.stringify(this.users, null, 2));
    } catch (err) {
      console.error('[MemoryStore] Failed to save users file:', err.message);
    }
  }

  /** True when Mongoose has an active connection */
  get isMongoConnected() {
    return mongoose.connection.readyState === 1;
  }

  /** Lazily require the Mongoose User model (avoids circular deps) */
  get UserModel() {
    return require('../models/User');
  }

  // ── findOne ─────────────────────────────────────────────────────────
  async findOne(query) {
    if (this.isMongoConnected) {
      // +password because schema has select:false
      return await this.UserModel.findOne(query).select('+password').lean();
    }
    return this.users.find(user => {
      if (query.email) return user.email === query.email;
      if (query._id) return user._id === query._id;
      return false;
    }) || null;
  }

  // ── create ──────────────────────────────────────────────────────────
  async create(userData) {
    if (this.isMongoConnected) {
      const user = await this.UserModel.create({
        name: userData.name,
        email: userData.email,
        password: userData.password, // Mongoose pre-save hook hashes it
        role: userData.role || 'hr',
        company: userData.company || '',
        isActive: true
      });
      // Return lean object with password for immediate JWT flows
      return user.toObject();
    }

    // File-based fallback (persistent)
    const hashedPassword = await bcrypt.hash(userData.password, 12);
    const newUser = {
      _id: uuidv4(),
      name: userData.name,
      email: userData.email,
      password: hashedPassword,
      role: userData.role || 'user',
      company: userData.company || '',
      isActive: true,
      createdAt: new Date().toISOString(),
      lastLogin: null
    };
    this.users.push(newUser);
    this._saveToFile();
    return newUser;
  }

  // ── findById ────────────────────────────────────────────────────────
  async findById(id) {
    if (this.isMongoConnected) {
      try {
        return await this.UserModel.findById(id).select('+password').lean();
      } catch {
        return null;
      }
    }
    return this.users.find(user => user._id === id) || null;
  }

  // ── findByIdAndUpdate ───────────────────────────────────────────────
  async findByIdAndUpdate(id, updateData, options = {}) {
    if (this.isMongoConnected) {
      try {
        return await this.UserModel.findByIdAndUpdate(id, updateData, {
          new: options.new || false,
          runValidators: true
        }).lean();
      } catch {
        return null;
      }
    }

    const userIndex = this.users.findIndex(user => user._id === id);
    if (userIndex === -1) return null;
    this.users[userIndex] = { ...this.users[userIndex], ...updateData };
    this._saveToFile();
    return this.users[userIndex];
  }

  // ── findAll (for admin routes) ──────────────────────────────────────
  async findAll() {
    if (this.isMongoConnected) {
      return await this.UserModel.find().lean();
    }
    return this.users;
  }

  // ── deleteById ──────────────────────────────────────────────────────
  async deleteById(id) {
    if (this.isMongoConnected) {
      return await this.UserModel.findByIdAndDelete(id);
    }
    const idx = this.users.findIndex(u => u._id === id);
    if (idx === -1) return null;
    const deleted = this.users.splice(idx, 1)[0];
    this._saveToFile();
    return deleted;
  }

  // ── helper ──────────────────────────────────────────────────────────
  async comparePassword(candidatePassword, hashedPassword) {
    return await bcrypt.compare(candidatePassword, hashedPassword);
  }
}

module.exports = new MemoryStore();
