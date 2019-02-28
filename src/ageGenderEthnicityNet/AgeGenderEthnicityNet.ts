import * as tf from '@tensorflow/tfjs-core';
import { NetInput, NeuralNetwork, TNetInput, toNetInput } from 'tfjs-image-recognition-base';

import { EthnicityPrediction } from '../classes/EthnicityPrediction';
import { GenderPrediction } from '../classes/GenderPrediction';
import { fullyConnectedLayer } from '../common/fullyConnectedLayer';
import { seperateWeightMaps } from '../common/seperateWeightMaps';
import { FaceFeatureExtractor } from '../faceFeatureExtractor/FaceFeatureExtractor';
import { FaceFeatureExtractorParams, IFaceFeatureExtractor } from '../faceFeatureExtractor/types';
import { cOutAge, cOutEthnicity, cOutGender } from './const';
import { extractParams } from './extractParams';
import { extractParamsFromWeigthMap } from './extractParamsFromWeigthMap';
import { NetParams } from './types';

export class AgeGenderEthnicityNet extends NeuralNetwork<NetParams> {

  protected _faceFeatureExtractor: FaceFeatureExtractor

  constructor(faceFeatureExtractor: FaceFeatureExtractor = new FaceFeatureExtractor()) {
    super('AgeGenderEthnicityNet')
    this._faceFeatureExtractor = faceFeatureExtractor
  }

  public get faceFeatureExtractor(): IFaceFeatureExtractor<FaceFeatureExtractorParams> {
    return this._faceFeatureExtractor
  }

  public runNet(input: NetInput | tf.Tensor4D): { age: tf.Tensor2D, gender: tf.Tensor2D, ethnicity: tf.Tensor2D } {

    const { params } = this

    if (!params) {
      throw new Error(`${this._name} - load model before inference`)
    }

    return tf.tidy(() => {
      const bottleneckFeatures = input instanceof NetInput
        ? this.faceFeatureExtractor.forwardInput(input)
        : input

      const fcIn = bottleneckFeatures.as2D(bottleneckFeatures.shape[0], -1)

      const age = fullyConnectedLayer(fcIn, params.fc.age)
      const gender = fullyConnectedLayer(fcIn, params.fc.gender)
      const ethnicity = fullyConnectedLayer(fcIn, params.fc.ethnicity)

      return { age, gender, ethnicity }
    })
  }

  public forwardInput(input: NetInput | tf.Tensor4D): { age: tf.Tensor2D, gender: tf.Tensor2D, ethnicity: tf.Tensor2D } {
    return tf.tidy(() => {
      const { age, gender, ethnicity } = this.runNet(input)
      return {
        age,
        gender: tf.softmax(gender),
        ethnicity: tf.softmax(ethnicity)
      }
    })
  }

  public async forward(input: TNetInput): Promise<{ age: tf.Tensor2D, gender: tf.Tensor2D, ethnicity: tf.Tensor2D }> {
    return this.forwardInput(await toNetInput(input))
  }

  public async predictAgeGenderAndEthnicity(input: TNetInput) {
    const netInput = await toNetInput(input)
    const out = await this.forwardInput(netInput)
    const [ageData, genderData, ethnicityData] = await Promise.all([out.age.data(), out.gender.data(), out.ethnicity.data()])

    const age = ageData[0]

    out.age.dispose()
    out.gender.dispose()
    out.ethnicity.dispose()

    const gender = GenderPrediction.fromProbabilities(genderData as Float32Array)
    const ethnicity = EthnicityPrediction.fromProbabilities(ethnicityData as Float32Array)

    return { age, gender, ethnicity }
  }

  public dispose(throwOnRedispose: boolean = true) {
    this.faceFeatureExtractor.dispose(throwOnRedispose)
    super.dispose(throwOnRedispose)
  }

  public loadClassifierParams(weights: Float32Array) {
    const { params, paramMappings } = this.extractClassifierParams(weights)
    this._params = params
    this._paramMappings = paramMappings
  }

  public extractClassifierParams(weights: Float32Array) {
    return extractParams(weights, this.getClassifierChannelsIn())
  }

  protected extractParamsFromWeigthMap(weightMap: tf.NamedTensorMap) {

    const { featureExtractorMap, classifierMap } = seperateWeightMaps(weightMap)

    this.faceFeatureExtractor.loadFromWeightMap(featureExtractorMap)

    return extractParamsFromWeigthMap(classifierMap)
  }

  protected extractParams(weights: Float32Array) {

    const cIn = this.getClassifierChannelsIn()

    const getClassifierWeightSize = (cOut: number) => (cOut * cIn) + cOut
    const classifierWeightSize = getClassifierWeightSize(cOutAge)
      + getClassifierWeightSize(cOutGender)
      + getClassifierWeightSize(cOutEthnicity)

    const featureExtractorWeights = weights.slice(0, weights.length - classifierWeightSize)
    const classifierWeights = weights.slice(weights.length - classifierWeightSize)

    this.faceFeatureExtractor.extractWeights(featureExtractorWeights)
    return this.extractClassifierParams(classifierWeights)
  }

  protected getDefaultModelName(): string {
    return 'age_gender_ethnicity_model'
  }

  protected getClassifierChannelsIn(): number {
    return 256
  }
}