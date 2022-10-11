import * as THREE from 'three';
import metaversefile from 'metaversefile';
import {GLTFLoader} from 'three/examples/jsm/loaders/GLTFLoader.js';
import {Matrix4} from 'three';

const {useApp, useCamera, useFrame, useText} = metaversefile;


export default () => {
  const app = useApp();
  const camera = useCamera();

  let uniforms = {
    hp: {value: 50},
    time: {value: 1}
  }

  const vertexShader = () => {
    return `
        varying vec2 vUv;
        varying float rara;
        uniform float width;
        uniform float height;
        uniform float time;

        varying vec4 v_foo;

        void main() {
            vUv = uv;

            vec4 modelViewPosition = modelViewMatrix * vec4(position, 1.0);
            gl_Position = projectionMatrix * modelViewPosition;

            if(gl_Position.x > 0.5) {
              rara = 0.5;
            }
            else {
              rara = 0.;
            }

            v_foo = gl_Position;

        }
    `;
  }

  const fragmentShader = () => {
    return `
        uniform sampler2D texture1;
        //uniform sampler2D texture2;
        varying vec2 vUv;
        varying float rara;
        uniform float width;
        uniform float height;
        uniform float time;

        uniform float hp;

        varying vec4 v_foo;

        void main() {
            vec3 colorRed = vec3(247., 0., 0.) / 255.0;
            vec3 colorWhite = vec3(11., 26., 34.) / 255.0;

            float pulse = sin(time) + 1.;
            //float letters = 1. - letter(uUv.x / 3. * clamp(1, 1., 2.), 1.) * pulse;

            float cut = step(0.01, vUv.x);
            //vec4 finalColor = vec4(colorRed.rgb, 1);
            //vec3 finalColor = vec3(1. - uv.r) * letters;
            //finalColor += vec4(1. - letters) * vec4(1. - cut) * vec4(colorRed.rgb, 1);

            if(vUv.x < hp) {
              gl_FragColor = vec4(colorRed, 1);
            }
            else {
              gl_FragColor = vec4(colorWhite, 1);
            }
        }
    `;
  }

  let material =  new THREE.ShaderMaterial({
    uniforms: uniforms,
    fragmentShader: fragmentShader(),
    vertexShader: vertexShader(),
    side: THREE.DoubleSide
  })

  let geom = new THREE.PlaneGeometry(12,0.5);
  let mesh = new THREE.Mesh(geom, material);

  app.add(mesh);

  let realHealth = 76;

  useFrame(({timeDiffS}) => {

    if(mesh) {
      let baseHealth = 100;

      // this.mesh.position.copy(this.owner.position).add(new THREE.Vector3(0,0.5,0));
      mesh.position.set(0,4,0);
      mesh.quaternion.copy(camera.quaternion);

      // if(realHealth < 100) {
      //   realHealth += 0.1;
      // }
      // if(realHealth > 0) {
      //   realHealth -= 0.1;
      // }

      if(realHealth >= 0 && realHealth < 100) {
        //realHealth += 0.5;
      }
      else {
        //realHealth -= 0.1;
      }


      let health = realHealth / 100;
      //health = Math.sin(realHealth);

      // this.mesh.rotation.copy(camera.rotation);
      // this.mesh.updateMatrixWorld();

      //if()
      mesh.material.uniforms.time.value = timeDiffS;
      mesh.material.uniforms.hp.value = health;
      mesh.material.uniformsNeedUpdate = true;
    }

  });

  return app;
};
