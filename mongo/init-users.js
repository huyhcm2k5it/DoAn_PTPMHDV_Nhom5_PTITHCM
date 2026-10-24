function createOwnerUsers(passwords) {
  const owners = [
    { key: "patient", database: "patient_db", username: "patient-service" },
    { key: "appointment", database: "appointment_db", username: "appointment-service" },
    { key: "pharmacy", database: "pharmacy_db", username: "pharmacy-service" }
  ];
  for (const owner of owners) {
    const database = db.getSiblingDB(owner.database);
    const existing = database.getUser(owner.username);
    if (existing) {
      const roles = existing.roles || [];
      if (roles.length !== 1 || roles[0].role !== "readWrite" || roles[0].db !== owner.database) throw new Error("Unexpected role on " + owner.username);
      continue;
    }
    if (!passwords[owner.key]) throw new Error("Missing password for " + owner.key);
    database.createUser({ user: owner.username, pwd: passwords[owner.key], roles: [{ role: "readWrite", db: owner.database }] });
  }
}