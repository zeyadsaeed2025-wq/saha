import { seedDemo } from '../modules/demo/seed.js';

const result = await seedDemo();
console.log(JSON.stringify({
  organization: result.organization.name,
  adminPhone: result.adminPhone,
  adminPassword: result.adminPassword,
  alreadySeeded: result.alreadySeeded,
}, null, 2));
