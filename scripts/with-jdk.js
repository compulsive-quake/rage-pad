// with-jdk.js - Sets JAVA_HOME from local .jdk install (if present) then runs the given command.
// Usage: node scripts/with-jdk.js <command> [args...]

const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const jdkDir = path.join(__dirname, '..', '.jdk', 'temurin-17');
if (fs.existsSync(jdkDir)) {
  const sub = fs.readdirSync(jdkDir).find(f => fs.statSync(path.join(jdkDir, f)).isDirectory());
  if (sub) {
    process.env.JAVA_HOME = path.resolve(jdkDir, sub);
    console.log(`JAVA_HOME=${process.env.JAVA_HOME}`);
  }
}

const cmd = process.argv.slice(2).join(' ');
if (!cmd) {
  console.error('Usage: node scripts/with-jdk.js <command> [args...]');
  process.exit(1);
}

try {
  execSync(cmd, { stdio: 'inherit', env: process.env });
} catch (e) {
  process.exit(e.status || 1);
}
