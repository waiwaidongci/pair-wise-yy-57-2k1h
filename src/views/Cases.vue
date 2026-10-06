<script setup lang="ts">
import { computed, ref } from 'vue'
import { useTestStore } from '../store'
import { formatDateTime } from '../construction'

const store = useTestStore()
const editMode = ref(false)
const selectedCase = computed(() => store.selectedCase)
</script>

<template>
  <section class="page-head"><div><p class="eyebrow">步骤、预期与依赖</p><h1>测试用例编排</h1><p>用例只对当前施工账负责：关联施工单一变，步骤判定立即清空重核，历史结论留在作废记录里。</p></div><n-space><n-switch v-model:value="editMode">重核录入模式</n-switch></n-space></section>
  <div class="case-grid"><aside class="card case-list"><n-input placeholder="搜索用例、进路或施工编号" clearable /><button v-for="item in store.cases" :key="item.id" :class="{active:item.id===store.selectedCaseId}" @click="store.selectCase(item.id)"><div><b>{{item.id}}</b><small>{{item.name}}</small><small>依据 {{item.basisConstructionIds.join('、') || '无'}}</small></div><n-tag :type="item.status==='通过'?'success':item.status==='失败'?'error':item.status==='阻塞'?'warning':item.status==='待重核'?'default':'info'">{{item.status}}</n-tag></button></aside>
    <article class="card detail" v-if="selectedCase">
      <div class="panel-head"><div><h2>{{selectedCase.id}} · {{selectedCase.name}}</h2><p>{{selectedCase.precondition}}</p></div><n-tag :type="selectedCase.status==='待重核'?'default':'info'">{{selectedCase.status}} · {{selectedCase.version}}</n-tag></div>
      <n-alert :type="selectedCase.status==='待重核'?'warning':'info'" class="issue" :title="`当前判定依据施工单：${selectedCase.basisConstructionIds.join('、') || '无（不参与发布门禁）'}`" :description="selectedCase.invalidatedByConstruction ? `最近由 ${selectedCase.invalidatedByConstruction} 触发作废再核` : '施工账建立后旧判定已统一作废'" />
      <n-alert v-if="selectedCase.failureReason" type="error" title="当前失败原因（本次重测新证据）" :description="selectedCase.failureReason" />
      <h3>执行步骤与依赖</h3>
      <div v-for="(step,index) in selectedCase.steps" :key="step.id" class="step"><div class="step-index">{{index+1}}</div><div class="step-main"><div class="step-head"><b>{{step.action}}</b><n-tag :type="step.result==='通过'?'success':step.result==='失败'?'error':'default'">{{step.result}}</n-tag></div><p>预期：{{step.expected}}</p><small v-if="step.dependency">依赖步骤：{{step.dependency}}</small><small v-if="step.actual">本次实测：{{step.actual}}</small><small v-if="step.evidence">本次证据：{{step.evidence}}</small></div><n-button v-if="editMode && step.result!=='通过'" size="small" @click="store.setStepResult(selectedCase.id,step.id,'通过','重核确认一致')">重核标记通过</n-button></div>
      <n-divider />
      <h3>作废留痕（旧证据归档，不得沿用）</h3>
      <n-empty v-if="selectedCase.voidedVerdicts.length===0" description="无作废记录" size="small" style="margin:8px 0" />
      <div v-for="(voided,index) in selectedCase.voidedVerdicts" :key="index" class="void-row">
        <div><b>{{voided.constructionId}} rev.{{voided.revision}}</b><n-tag size="small" type="error" style="margin-left:8px">原{{voided.previousStatus}}已作废</n-tag></div>
        <p>{{voided.note}}</p>
        <small>作废于 {{formatDateTime(voided.voidedAt)}}{{voided.previousReason ? ' · 原失败原因：'+voided.previousReason : ''}}</small>
        <small v-if="voided.previousEvidence.length">归档证据（仅供追溯）：{{voided.previousEvidence.join('、')}}</small>
      </div>
    </article></div>
</template>
