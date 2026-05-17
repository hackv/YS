const bcrypt = require('bcryptjs');

async function main() {
  const password = 'admin123';
  const hash = await bcrypt.hash(password, 10);
  console.log('Password hash for admin123:');
  console.log(hash);
}

main().catch(console.error);