process.on('unhandledRejection', err => {
  console.error('Publish failed with:', err.message);
  console.trace();
  throw err;
});

const S3 = require('aws-sdk/clients/s3');
const fs = require('fs');
const _ = require('lodash');
const appRoot = require('app-root-path');
const spawn = require('child_process').spawn;
const program = require('commander');

const s3 = new S3({ apiVersion: '2006-03-01' });

async function build(publicUrl) {
  return new Promise((resolve, reject) => {
    const build = spawn('npm', ['run-script', 'build'], {
      env: { ...process.env, PUBLIC_URL: publicUrl },
      stdio: 'inherit',
    });
    build.on('error', function(err) {
      console.error('Build error', err);
      reject(err);
    });
    build.on('exit', function(code) {
      if (code === 0) resolve();
      else reject(code);
    });
  });
}

async function pathExists(bucket, path) {
  const list = await s3.listObjects({ Bucket: bucket, Prefix: path }).promise();
  return list.Contents.length > 0;
}

async function uploadFileToS3(bucket, key, file, type) {
  console.log('Uploading', file, 'to', key);
  await s3
    .putObject({
      Bucket: bucket,
      Key: key,
      Body: fs.readFileSync(file),
      ACL: 'public-read',
      ContentType: type,
    })
    .promise();
}

async function uploadJsFileToS3(bucket, key, file) {
  return await uploadFileToS3(bucket, key, file, 'application/javascript');
}

async function uploadCssFileToS3(bucket, key, file) {
  return await uploadFileToS3(bucket, key, file, 'text/css');
}

function deslashUrl(url) {
  // Removes double slashes within a url, except after the protocol
  return url.replace(/(?<![a-z]+:)\/\//g, '/');
}

async function publish({
  s3Bucket,
  s3Path,
  localPath,
  appVersion,
  publicUrlBase,
  force,
  sourceMaps,
}) {
  const version = appVersion || require(appRoot + '/package.json').version;
  console.log(
    'Preparing to deploy version',
    version,
    'from',
    localPath,
    'to',
    's3://' + s3Bucket + '/' + s3Path
  );

  const versionS3Path = s3Path + '/' + version;
  const exists = await pathExists(s3Bucket, versionS3Path);

  if (exists) {
    console.log('Version ' + version + ' already exists in S3.');
    if (force) {
      console.log('Force flag is set, overwriting.');
    } else {
      console.log(
        'If you wish to overwrite it please specify the --force option and run the script again.'
      );
      process.exit(1);
    }
  }

  console.log('Building app');
  await build(deslashUrl(`${publicUrlBase}/${versionS3Path}/`));

  localPath = localPath.replace(/\/$/, '');
  let jsFiles;
  let cssFiles;
  try {
    const files = fs.readdirSync(localPath);
    jsFiles = files
      .filter(f => f.endsWith('.js') || (sourceMaps && f.endsWith('.js.map')))
      .filter(f => f !== 'service-worker.js');
    cssFiles = files.filter(
      f => f.endsWith('.css') || (sourceMaps && f.endsWith('.css.map'))
    );
  } catch (e) {
    console.log("Couldn't read script path dir.");
    console.log(e.message);
    process.exit(1);
  }

  if (jsFiles.length === 0) {
    console.log('No main js file found');
    process.exit(1);
  }

  const jsUploads = jsFiles.map(filename =>
    uploadJsFileToS3(
      s3Bucket,
      `${versionS3Path}/${filename}`,
      `${localPath}/${filename}`
    )
  );
  const cssUploads = cssFiles.map(filename =>
    uploadCssFileToS3(
      s3Bucket,
      `${versionS3Path}/${filename}`,
      `${localPath}/${filename}`
    )
  );
  const uploads = jsUploads.concat(cssUploads);
  await Promise.all(uploads);

  console.log('Deployment complete');
  console.log('Main script can now be found here:');
  console.log(deslashUrl(`${publicUrlBase}/${versionS3Path}/main.js`));
}

program
  .version('0.1.0')
  .option('--s3-bucket <bucket-name>', 'S3 bucket to upload to')
  .option(
    '--s3-path <path>',
    'Path on the S3 bucket to upload to (omit for the root)'
  )
  .option('--local-path <script-path>', 'Path of local js/css files to upload')
  .option(
    '--app-version [app-version]',
    'Override app version, typically read from project/package.json if not set'
  )
  .option(
    '--public-url-base <public-url-base>',
    'The script needs this to reference other chunks from the main.js file'
  )
  .option(
    '--source-maps [source-maps]',
    'Whether to publish source maps (defaults to no)',
    false
  )
  .option(
    '-f, --force [force]',
    'Force uploading this version even if it already exists'
  )
  .parse(process.argv);

const required = ['s3Bucket', 's3Path', 'localPath'];
for (const opt of required) {
  if (typeof program[opt] === 'undefined') {
    console.log('Missing required argument', opt);
    process.exit(1);
  }
}

publish(program);
