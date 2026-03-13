import fs from 'fs';
import path from 'path';

function walkSync(dir, filelist = []) {
  fs.readdirSync(dir).forEach(file => {
    let filepath = path.join(dir, file);
    if (fs.statSync(filepath).isDirectory()) {
      filelist = walkSync(filepath, filelist);
    } else {
      filelist.push(filepath);
    }
  });
  return filelist;
}

const cssFiles = walkSync('./src').filter(file => file.endsWith('.css'));

let replacedCount = 0;

cssFiles.forEach(file => {
  let content = fs.readFileSync(file, 'utf8');
  let newContent = content;

  // Replace primary 2-color gradient
  newContent = newContent.replace(
    /linear-gradient\([^,]+,\s*(?:#7c5cfc|#00d4ff)[^)]*\)/gi,
    'linear-gradient(90deg, hsla(340, 80%, 69%, 1) 0%, hsla(15, 93%, 71%, 1) 100%)'
  );

  // Replace primary text gradients
  newContent = newContent.replace(
    /linear-gradient\([^,]+,\s*#ededed,\s*#7c5cfc\)/gi,
    'linear-gradient(135deg, #ededed, hsla(340, 80%, 69%, 1))'
  );

  // Replace raw hex colors
  newContent = newContent.replace(/#7c5cfc/gi, 'hsla(340, 80%, 69%, 1)');
  newContent = newContent.replace(/#00d4ff/gi, 'hsla(15, 93%, 71%, 1)');
  newContent = newContent.replace(/#907cff/gi, 'hsla(340, 80%, 75%, 1)'); // Hover state

  if (content !== newContent) {
    fs.writeFileSync(file, newContent);
    replacedCount++;
  }
});

console.log(`Replaced colors in ${replacedCount} CSS files.`);
