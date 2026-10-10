import esbuild from 'esbuild'

await esbuild.build({
  entryPoints: ['src/client/plan.js'],
  bundle: true,
  format: 'iife',
  outfile: 'client/plan.js',
  sourcemap: true,
  minify: true,
})
console.log('built client/plan.js')
